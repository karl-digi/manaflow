import { query } from "@anthropic-ai/claude-agent-sdk";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";

import { logToScreenshotCollector } from "./logger";
import { formatClaudeMessage } from "./claudeMessageFormatter";

export const SCREENSHOT_STORAGE_ROOT = "/root/screenshots";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".avi"]);

function isScreenshotFile(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isVideoFile(fileName: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isMediaFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext);
}

function getMediaType(fileName: string): "image" | "video" {
  return VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase()) ? "video" : "image";
}

/** A captured media item (screenshot or video) */
export interface CapturedMedia {
  path: string;
  description?: string;
  /** Media type: "image" for screenshots, "video" for recordings */
  mediaType?: "image" | "video";
  /** Duration in milliseconds (for videos only) */
  durationMs?: number;
}

const screenshotOutputSchema = z.object({
  hasUiChanges: z.boolean(),
  images: z
    .array(
      z.object({
        path: z.string().min(1),
        description: z.string().min(1),
        // Accept any string for mediaType, normalize to image/video
        mediaType: z.string().optional().transform(v =>
          v === "video" ? "video" as const : "image" as const
        ),
        // Accept string or number for durationMs
        durationMs: z.union([z.number(), z.string().transform(Number)]).optional(),
      }) // Allow extra fields without failing
    )
    .default([]),
});

type ScreenshotStructuredOutput = z.infer<typeof screenshotOutputSchema>;

// Lenient JSON schema - no additionalProperties:false, no strict enums
// The Zod schema handles validation and normalization
const screenshotOutputJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["hasUiChanges", "images"],
  properties: {
    hasUiChanges: { type: "boolean" },
    images: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "description"],
        properties: {
          path: { type: "string" },
          description: { type: "string" },
          mediaType: { type: "string" },
          durationMs: { type: "number" },
        },
      },
    },
  },
} as const;

async function collectMediaFiles(
  directory: string
): Promise<{ files: string[]; hasNestedDirectories: boolean }> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  let hasNestedDirectories = false;

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      hasNestedDirectories = true;
      const nested = await collectMediaFiles(fullPath);
      files.push(...nested.files);
    } else if (entry.isFile() && isMediaFile(entry.name)) {
      files.push(fullPath);
    }
  }

  return { files, hasNestedDirectories };
}

export function normalizeScreenshotOutputDir(outputDir: string): string {
  if (path.isAbsolute(outputDir)) {
    return path.normalize(outputDir);
  }
  return path.resolve(SCREENSHOT_STORAGE_ROOT, outputDir);
}

export type ClaudeCodeAuthConfig =
  | { auth: { taskRunJwt: string } }
  | { auth: { anthropicApiKey: string } };

type BranchBaseOptions = {
  workspaceDir: string;
  changedFiles: string[];
  prTitle: string;
  prDescription: string;
  outputDir: string;
  pathToClaudeCodeExecutable?: string;
  /** Combined setup script (maintenance + dev), if provided */
  setupScript?: string;
  /** Command to install dependencies (e.g., "bun install", "npm install") */
  installCommand?: string;
  /** Command to start the dev server (e.g., "bun run dev", "npm run dev") */
  devCommand?: string;
  convexSiteUrl?: string;
};

type BranchCaptureOptions =
  | (BranchBaseOptions & { branch: string; auth: { taskRunJwt: string } })
  | (BranchBaseOptions & { branch: string; auth: { anthropicApiKey: string } });

type CaptureScreenshotsBaseOptions = BranchBaseOptions & {
  baseBranch: string;
  headBranch: string;
};

export type CaptureScreenshotsOptions =
  | (CaptureScreenshotsBaseOptions & { auth: { taskRunJwt: string } })
  | (CaptureScreenshotsBaseOptions & { auth: { anthropicApiKey: string } });

export interface ScreenshotResult {
  status: "completed" | "failed" | "skipped";
  /** Screenshots captured (legacy field, use 'media' for new code) */
  screenshots?: { path: string; description?: string }[];
  /** All captured media (screenshots and videos) */
  media?: CapturedMedia[];
  hasUiChanges?: boolean;
  error?: string;
  reason?: string;
}

/**
 * Use Claude Agent SDK with Playwright MCP to capture screenshots
 * Assumes the workspace is already set up with the correct branch checked out
 */
function isTaskRunJwtAuth(
  auth: ClaudeCodeAuthConfig["auth"]
): auth is { taskRunJwt: string } {
  return "taskRunJwt" in auth;
}

function log(
  level: "INFO" | "WARN" | "ERROR",
  message: string,
  data?: Record<string, unknown>
): void {
  const logData = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[${level}] ${message}${logData}`);
}

function formatOptionalValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "<unset>";
}

function formatSecretValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "<unset>";
  return `present(length=${trimmed.length})`;
}

export async function captureScreenshotsForBranch(
  options: BranchCaptureOptions
): Promise<{
  screenshots: { path: string; description?: string }[];
  media: CapturedMedia[];
  hasUiChanges?: boolean;
}> {
  const {
    workspaceDir,
    changedFiles,
    prTitle,
    prDescription,
    branch,
    outputDir: requestedOutputDir,
    auth,
    setupScript,
    installCommand,
    devCommand,
    convexSiteUrl,
  } = options;
  const outputDir = normalizeScreenshotOutputDir(requestedOutputDir);
  const useTaskRunJwt = isTaskRunJwtAuth(auth);
  const providedApiKey = !useTaskRunJwt ? auth.anthropicApiKey : undefined;

  const devInstructions = (() => {
    const normalizedSetupScript = setupScript?.trim() ?? "";
    const fallbackSetupScript = [installCommand?.trim(), devCommand?.trim()]
      .filter(Boolean)
      .join("\n\n");
    const resolvedSetupScript = normalizedSetupScript || fallbackSetupScript;

    if (resolvedSetupScript) {
      return `
The user provided the following setup script (maintenance + dev combined). If no dev server is running, use this script to start it:
<setup_script>
${resolvedSetupScript}
</setup_script>`;
    }

    if (!installCommand && !devCommand) {
      return `
The user did not provide installation or dev commands. You will need to discover them by reading README.md, package.json, .devcontainer.json, or other configuration files.`;
    }
    const parts = ["The user provided the following commands:"];
    if (installCommand) {
      parts.push(`<install_command>\n${installCommand}\n</install_command>`);
    } else {
      parts.push(
        "(No install command provided - check README.md or package.json)"
      );
    }
    if (devCommand) {
      parts.push(`<dev_command>\n${devCommand}\n</dev_command>`);
    } else {
      parts.push(
        "(No dev command provided - check README.md or package.json)"
      );
    }
    return "\n" + parts.join("\n");
  })();

  const prompt = `IMPORTANT: This is a tool-using task. You MUST use tools to complete it. Do NOT respond with just text.

You are a media collector for pull request reviews. Your task:
1. Use tools to analyze the changed files
2. If UI changes exist, use tools to capture screenshots/videos
3. Save all media to the output directory with descriptive filenames

You can capture BOTH screenshots and videos - choose the appropriate medium:
- **Screenshots**: For static UI (layouts, styling, content, colors, typography)
- **Videos**: For interactive/animated UI (button clicks, form submissions, transitions, modals opening/closing, loading states, drag-and-drop, animations)

<PR_CONTEXT>
Title: ${prTitle}
Description: ${prDescription || "No description provided"}
Branch: ${branch}
Files changed:
${changedFiles.map((f) => `- ${f}`).join("\n")}
</PR_CONTEXT>

<ENVIRONMENT>
Working directory: ${workspaceDir}
Screenshot output directory: ${outputDir}
${devInstructions}
</ENVIRONMENT>

<PHASE_1_ANALYSIS>
First, analyze the changed files to determine if this PR contains UI changes.

IMPORTANT: Base your decision on the ACTUAL FILES CHANGED, not the PR title or description. PR descriptions can be misleading or incomplete. If the diff contains UI-affecting code, there ARE UI changes regardless of what the description says.

UI changes ARE present if the PR modifies code that affects what users see in the browser:
- Frontend components or templates (any framework: React, Vue, Rails ERB, PHP Blade, Django templates, etc.)
- Stylesheets (CSS, SCSS, Tailwind, styled-components, etc.)
- Markup or template files (HTML, JSX, ERB, Twig, Jinja, Handlebars, etc.)
- Client-side JavaScript/TypeScript that affects rendering
- UI states like loading indicators, error messages, empty states, or toasts
- Accessibility attributes, ARIA labels, or semantic markup

UI changes are NOT present if the PR only modifies:
- Server-side logic that doesn't change what's rendered (API handlers, database queries, background jobs)
- Configuration files (unless they affect theming or UI behavior)
- Tests, documentation, or build scripts
- Type definitions or interfaces for non-UI code

If no UI changes exist: Set hasUiChanges=false, take ZERO screenshots, and explain why. Do not start the dev server or open a browser.
</PHASE_1_ANALYSIS>

<PHASE_2_CAPTURE>
If UI changes exist, capture screenshots and/or record videos:

1. FIRST, check if the dev server is ALREADY RUNNING:
   - Run \`tmux list-windows\` and \`tmux capture-pane -p -t <window>\` to see running processes and their logs
   - Check if there's a dev server process starting up or already running in any tmux window
   - For cloud tasks, also inspect cmux-pty output/logs (tmux may not be used). Look for active dev server commands there.
   - The dev server is typically started automatically in this environment - BE PATIENT and monitor the logs
   - If you see the server is starting/compiling, WAIT for it to finish - do NOT kill it or restart it
   - Use \`ss -tlnp | grep LISTEN\` to see what ports have servers listening
2. ONLY if no server is running anywhere: Read CLAUDE.md, README.md, or package.json for setup instructions. Install dependencies if needed, then start the dev server.
3. BE PATIENT - servers can take time to compile. Monitor tmux logs to see progress. A response from curl (even 404) means the server is up. Do NOT restart the server if it's still compiling.
4. Navigate to the pages/components modified in the PR
5. Capture screenshots OR record videos based on the nature of the UI changes:

   **Take SCREENSHOTS for:**
   - The default/resting state of changed components
   - Static layouts, styling, colors, typography changes
   - Responsive layouts if the PR includes responsive changes

   **Record VIDEOS for:**
   - Interactive flows: clicking buttons, submitting forms, navigation
   - Animations and transitions (hover effects, page transitions, loading sequences)
   - Modals, dropdowns, tooltips opening and closing
   - Drag-and-drop functionality
   - Multi-step user journeys (e.g., form → submit → success message)
   - Any UI that requires user interaction to demonstrate

6. Save media to ${outputDir} with descriptive names:
   - Screenshots: "component-state-${branch}.png"
   - Videos: "component-interaction-${branch}.mp4"

**VIDEO RECORDING INSTRUCTIONS:**
To record a video, use ffmpeg to capture the X11 display:
\`\`\`bash
# Start recording (runs in background)
ffmpeg -y -f x11grab -video_size 1920x1080 -framerate 30 -i :99 -c:v libx264 -preset ultrafast -crf 23 -pix_fmt yuv420p ${outputDir}/video-name.mp4 &
FFMPEG_PID=$!

# Perform the interactions you want to record...
# (click buttons, fill forms, navigate pages, etc.)

# Stop recording after capturing the interaction
kill -SIGINT $FFMPEG_PID
wait $FFMPEG_PID 2>/dev/null
\`\`\`
Keep videos SHORT (3-10 seconds) - just enough to demonstrate the interaction.
</PHASE_2_CAPTURE>

<PHASE_3_QUALITY_VERIFICATION>
After capturing media, you MUST verify each screenshot/video for quality. For EACH media file in ${outputDir}:

1. OPEN the file and visually inspect it (for videos, watch the recording)
2. EVALUATE the media against these quality criteria:
   - Does it show the intended UI component/page that the filename suggests?
   - Is the content fully loaded (no unintended spinners, skeleton loaders, or partial renders)?
   - Is the relevant UI element fully visible and not cut off?
   - Is the media free of error states, console overlays, or dev tool artifacts (unless intentionally capturing those)?
   - Does it accurately represent the PR changes you intended to capture?
   - For videos: Does it clearly show the interaction from start to finish?

3. DECIDE: Is this good media?
   - GOOD: The media clearly captures the intended UI state/interaction. Keep it.
   - BAD: The media is blurry, shows wrong content, has unintended loading states, is cut off, or doesn't represent the PR changes. DELETE IT.

4. If BAD: Delete the media file from the filesystem using \`rm <filepath>\`. Then either:
   - Retake after fixing the issue (refresh page, wait for content to load, scroll to element, resize viewport)
   - Skip if the UI state cannot be reproduced

5. Only include media in your final output that you have verified as GOOD quality.

Be ruthless about quality. A few excellent captures are far more valuable than many mediocre ones. Delete anything that doesn't clearly demonstrate the UI changes.
</PHASE_3_QUALITY_VERIFICATION>

<WHAT_TO_CAPTURE>
Capture the UI states/interactions that the PR actually modifies. Be intentional about choosing screenshots vs videos:

**Use SCREENSHOTS for static changes:**
- If the PR changes a loading spinner → screenshot the loading state
- If the PR changes error handling UI → screenshot the error state
- If the PR changes a skeleton loader → screenshot the skeleton
- If the PR changes hover styles → screenshot the hover state
- If the PR changes a modal's appearance → screenshot the modal

**Use VIDEOS for interactive changes:**
- If the PR changes a button's click behavior → record clicking it and the result
- If the PR changes form submission → record filling the form and submitting
- If the PR changes a modal's open/close animation → record opening and closing it
- If the PR changes page transitions → record navigating between pages
- If the PR changes drag-and-drop → record the drag-and-drop interaction

Don't capture loading/error states incidentally while waiting for the "real" UI. Capture them when they ARE the change.
</WHAT_TO_CAPTURE>

<CRITICAL_MISTAKES>
Avoid these failure modes:

FALSE POSITIVE: Taking screenshots/videos when the PR has no UI changes. Backend-only, config, or test changes = hasUiChanges=false, zero media files.

FALSE NEGATIVE: Failing to capture when UI changes exist. If React components, CSS, or templates changed, you MUST capture them.

FAKE UI: Creating mock HTML files instead of capturing the real app. Never fabricate UIs. If the dev server won't start, report the failure.

WRONG PAGE: Capturing pages unrelated to the PR. Only capture components/pages that the changed files actually render.

DUPLICATE CAPTURES: Taking multiple identical screenshots or overlapping videos. Each media file should show something distinct.

INCOMPLETE CAPTURE: Missing important UI elements. Ensure full components are visible and not cut off.

WRONG MEDIUM: Using screenshots when video would better demonstrate the change (e.g., an interaction or animation), or using video for purely static changes.

LONG VIDEOS: Recording excessively long videos. Keep videos SHORT (3-10 seconds) - just enough to show the interaction clearly.
</CRITICAL_MISTAKES>

<OUTPUT_REQUIREMENTS>
When you are done capturing media, you will be asked to provide structured output with the following fields:
- hasUiChanges: boolean - whether the PR has UI changes
- images: array of captured media, each with:
  - path: absolute path to the saved file
  - description: what the media shows
  - mediaType: "image" for screenshots, "video" for recordings (optional)
  - durationMs: duration in milliseconds for videos (optional)

File naming convention:
- Screenshots: descriptive-name.png (e.g., "homepage-with-new-button.png")
- Videos: descriptive-name.mp4 (e.g., "button-click-interaction.mp4")

Additional rules:
- Do not close the browser when done
- Do not create summary documents or markdown files
- Save all media files to the output directory: ${outputDir}
</OUTPUT_REQUIREMENTS>`;

  await logToScreenshotCollector(
    `Starting Claude Agent with browser MCP for branch: ${branch}`
  );

  let structuredOutput: ScreenshotStructuredOutput | null = null;

  if (useTaskRunJwt && !convexSiteUrl) {
    await logToScreenshotCollector(
      "[WARN] convexSiteUrl is missing; Anthropic proxy requests may fail."
    );
  }
  const normalizedConvexSiteUrl = formatOptionalValue(convexSiteUrl);

  await logToScreenshotCollector(
    `[DEBUG] convexSiteUrl: ${normalizedConvexSiteUrl}`
  );

  const anthropicBaseUrl = `${normalizedConvexSiteUrl}/api/anthropic`;

  await logToScreenshotCollector(
    `[DEBUG] anthropicBaseUrl: ${anthropicBaseUrl}`
  );

  try {
    const hadOriginalApiKey = Object.prototype.hasOwnProperty.call(
      process.env,
      "ANTHROPIC_API_KEY"
    );
    const originalApiKey = process.env.ANTHROPIC_API_KEY;
    if (useTaskRunJwt) {
      delete process.env.ANTHROPIC_API_KEY;
      // Log JWT info for debugging
      await logToScreenshotCollector(
        `Using taskRun JWT auth. JWT present: ${!!auth.taskRunJwt}, JWT length: ${auth.taskRunJwt?.length ?? 0}, JWT first 20 chars: ${auth.taskRunJwt?.substring(0, 20) ?? "N/A"}`
      );
      await logToScreenshotCollector(
        `ANTHROPIC_BASE_URL: ${anthropicBaseUrl}`
      );
      await logToScreenshotCollector(
        `[DEBUG] ANTHROPIC_CUSTOM_HEADERS will be: x-cmux-token:<jwt>`
      );
    } else if (providedApiKey) {
      process.env.ANTHROPIC_API_KEY = providedApiKey;
      await logToScreenshotCollector(
        `Using API key auth. Key present: ${!!providedApiKey}, Key length: ${providedApiKey?.length ?? 0}`
      );
    }

    await logToScreenshotCollector(
      `Arguments to Claude Code: ${JSON.stringify({
        prompt,
        cwd: workspaceDir,
        pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
      })}`
    );

    const claudeEnv = {
      ...process.env,
      IS_SANDBOX: "1",
      CLAUDE_CODE_ENABLE_TELEMETRY: "0",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      ...(useTaskRunJwt
        ? {
          // Use a dummy key that doesn't start with "sk-ant-" so proxy routes to Bedrock
          // The JWT in ANTHROPIC_CUSTOM_HEADERS handles actual authentication
          ANTHROPIC_API_KEY: "bedrock-proxy-placeholder",
          ANTHROPIC_BASE_URL: anthropicBaseUrl,
          ANTHROPIC_CUSTOM_HEADERS: `x-cmux-token:${auth.taskRunJwt}`,
        }
        : providedApiKey
          ? {
            // Explicitly set API key to override any apiKeyHelper configuration
            ANTHROPIC_API_KEY: providedApiKey,
          }
          : {}),
    };

    await logToScreenshotCollector(
      `[DEBUG] Claude env: ${JSON.stringify({
        ANTHROPIC_BASE_URL: formatOptionalValue(claudeEnv.ANTHROPIC_BASE_URL),
        ANTHROPIC_CUSTOM_HEADERS: formatSecretValue(
          claudeEnv.ANTHROPIC_CUSTOM_HEADERS
        ),
        ANTHROPIC_API_KEY: formatSecretValue(claudeEnv.ANTHROPIC_API_KEY),
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: formatOptionalValue(
          claudeEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
        ),
        CLAUDE_CODE_ENABLE_TELEMETRY: formatOptionalValue(
          claudeEnv.CLAUDE_CODE_ENABLE_TELEMETRY
        ),
      })}`
    );

    try {
      for await (const message of query({
        prompt,
        options: {
          // model: "claude-haiku-4-5",
          model: "claude-opus-4-5",
          // mcpServers: {
          //   "playwright": {
          //     command: "bunx",
          //     args: [
          //       "@playwright/mcp",
          //       "--cdp-endpoint",
          //       "http://0.0.0.0:39382",
          //     ],
          //   },
          // },
          mcpServers: {
            chrome: {
              command: "bunx",
              args: [
                "chrome-devtools-mcp",
                "--browserUrl",
                "http://0.0.0.0:39382",
              ],
            },
          },
          // Note: allowDangerouslySkipPermissions cannot be used with root privileges
          // Using acceptEdits mode which auto-accepts file operations
          permissionMode: "acceptEdits",
          // Grant permissions for bash and MCP chrome tools
          allowedTools: [
            "Bash",
            "mcp__chrome__list_pages",
            "mcp__chrome__new_page",
            "mcp__chrome__navigate",
            "mcp__chrome__screenshot",
            "mcp__chrome__click",
            "mcp__chrome__type",
            "mcp__chrome__scroll",
            "mcp__chrome__evaluate",
            "mcp__chrome__close_page",
            "mcp__chrome__list_elements",
          ],
          cwd: workspaceDir,
          pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
          env: claudeEnv,
          stderr: (data) =>
            logToScreenshotCollector(`[claude-code-stderr] ${data}`),
          outputFormat: {
            type: "json_schema",
            schema: screenshotOutputJsonSchema,
          },
        },
      })) {
        // Format and log all message types
        const formatted = formatClaudeMessage(message);
        if (formatted) {
          await logToScreenshotCollector(formatted);
        }

        if (message.type === "result" && "structured_output" in message) {
          const parsed = screenshotOutputSchema.safeParse(
            message.structured_output
          );
          if (parsed.success) {
            structuredOutput = parsed.data;
            await logToScreenshotCollector(
              `Structured output captured (hasUiChanges=${parsed.data.hasUiChanges}, images=${parsed.data.images.length})`
            );
          } else {
            await logToScreenshotCollector(
              `Structured output validation failed: ${parsed.error.message}`
            );
          }
        }
      }
    } catch (error) {
      await logToScreenshotCollector(
        `Failed to capture screenshots with Claude Agent: ${error instanceof Error ? error.message : String(error)}`
      );
      log("ERROR", "Failed to capture screenshots with Claude Agent", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (hadOriginalApiKey) {
        if (originalApiKey !== undefined) {
          process.env.ANTHROPIC_API_KEY = originalApiKey;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }

    // Find all media files (screenshots and videos) in the output directory
    const mediaPaths: string[] = [];
    try {
      const { files, hasNestedDirectories } =
        await collectMediaFiles(outputDir);

      if (hasNestedDirectories) {
        await logToScreenshotCollector(
          `Detected nested media folders under ${outputDir}. Please keep all media files directly in the output directory.`
        );
      }

      const uniqueMedia = Array.from(
        new Set(files.map((filePath) => path.normalize(filePath)))
      ).sort();
      mediaPaths.push(...uniqueMedia);
    } catch (readError) {
      log("WARN", "Could not read media directory", {
        outputDir,
        error:
          readError instanceof Error ? readError.message : String(readError),
      });
    }

    // Build a map of path -> metadata from structured output
    const metadataByPath = new Map<string, { description: string; mediaType?: "image" | "video"; durationMs?: number }>();
    const resolvedOutputDir = path.resolve(outputDir);
    if (structuredOutput) {
      for (const image of structuredOutput.images) {
        const absolutePath = path.isAbsolute(image.path)
          ? path.normalize(image.path)
          : path.normalize(path.resolve(resolvedOutputDir, image.path));
        metadataByPath.set(absolutePath, {
          description: image.description,
          mediaType: image.mediaType,
          durationMs: image.durationMs,
        });
      }
    }

    // Build media array with descriptions and mediaType
    const mediaWithMetadata: CapturedMedia[] = mediaPaths.map((absolutePath) => {
      const normalized = path.normalize(absolutePath);
      const metadata = metadataByPath.get(normalized);
      const inferredMediaType = getMediaType(absolutePath);
      return {
        path: absolutePath,
        description: metadata?.description,
        mediaType: metadata?.mediaType ?? inferredMediaType,
        durationMs: metadata?.durationMs,
      };
    });

    // Legacy screenshots array (for backwards compatibility)
    const screenshotsWithDescriptions = mediaWithMetadata
      .filter((m) => m.mediaType === "image")
      .map((m) => ({ path: m.path, description: m.description }));

    if (
      structuredOutput &&
      structuredOutput.images.length > 0 &&
      metadataByPath.size === 0
    ) {
      await logToScreenshotCollector(
        "Structured output provided media descriptions, but none matched saved files; ensure paths are absolute or relative to the output directory."
      );
    }

    const imageCount = mediaWithMetadata.filter((m) => m.mediaType === "image").length;
    const videoCount = mediaWithMetadata.filter((m) => m.mediaType === "video").length;
    await logToScreenshotCollector(
      `Media collection complete: ${imageCount} screenshots, ${videoCount} videos`
    );

    return {
      screenshots: screenshotsWithDescriptions,
      media: mediaWithMetadata,
      hasUiChanges: structuredOutput?.hasUiChanges,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    await logToScreenshotCollector(
      `Failed to capture screenshots with Claude Agent: ${message}`
    );

    // Log full error details for debugging
    if (error instanceof Error) {
      if (error.stack) {
        await logToScreenshotCollector(`Stack trace: ${error.stack}`);
      }
      // Log any additional error properties
      const errorObj = error as Error & Record<string, unknown>;
      const additionalProps = Object.keys(errorObj)
        .filter((key) => !["message", "stack", "name"].includes(key))
        .map((key) => `${key}: ${JSON.stringify(errorObj[key])}`)
        .join(", ");
      if (additionalProps) {
        await logToScreenshotCollector(`Error details: ${additionalProps}`);
      }
    }

    throw error;
  }
}

/**
 * Capture screenshots for a PR
 * Assumes the workspace directory is already set up with git repo cloned
 */
export async function claudeCodeCapturePRScreenshots(
  options: CaptureScreenshotsOptions
): Promise<ScreenshotResult> {
  const {
    workspaceDir,
    changedFiles,
    prTitle,
    prDescription,
    baseBranch,
    headBranch,
    outputDir: requestedOutputDir,
    auth,
  } = options;
  const outputDir = normalizeScreenshotOutputDir(requestedOutputDir);

  try {
    await logToScreenshotCollector(
      `Starting PR screenshot capture in ${workspaceDir}`
    );

    if (changedFiles.length === 0) {
      const reason = "No files changed in PR";
      await logToScreenshotCollector(reason);
      return { status: "skipped", reason };
    }

    await logToScreenshotCollector(
      `Found ${changedFiles.length} changed files: ${changedFiles.join(", ")}`
    );

    await fs.mkdir(outputDir, { recursive: true });

    const allScreenshots: { path: string; description?: string }[] = [];
    const allMedia: CapturedMedia[] = [];
    let hasUiChanges: boolean | undefined;

    const CAPTURE_BEFORE = false;

    if (CAPTURE_BEFORE) {
      // Capture media for base branch (before changes)
      await logToScreenshotCollector(
        `Capturing 'before' media for base branch: ${baseBranch}`
      );
      const beforeMedia = await captureScreenshotsForBranch(
        isTaskRunJwtAuth(auth)
          ? {
          workspaceDir,
          changedFiles,
          prTitle,
          prDescription,
          branch: baseBranch,
          outputDir,
          auth: { taskRunJwt: auth.taskRunJwt },
          pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
          setupScript: options.setupScript,
          installCommand: options.installCommand,
          devCommand: options.devCommand,
          convexSiteUrl: options.convexSiteUrl,
        }
        : {
          workspaceDir,
          changedFiles,
          prTitle,
          prDescription,
          branch: baseBranch,
          outputDir,
          auth: { anthropicApiKey: auth.anthropicApiKey },
          pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
          setupScript: options.setupScript,
          installCommand: options.installCommand,
          devCommand: options.devCommand,
          convexSiteUrl: options.convexSiteUrl,
        }
      );
      allScreenshots.push(...beforeMedia.screenshots);
      allMedia.push(...beforeMedia.media);
      if (beforeMedia.hasUiChanges !== undefined) {
        hasUiChanges = beforeMedia.hasUiChanges;
      }
      const imageCount = beforeMedia.media.filter((m) => m.mediaType === "image").length;
      const videoCount = beforeMedia.media.filter((m) => m.mediaType === "video").length;
      await logToScreenshotCollector(
        `Captured 'before' media: ${imageCount} screenshots, ${videoCount} videos`
      );
    }

    // Capture media for head branch (after changes)
    await logToScreenshotCollector(
      `Capturing 'after' media for head branch: ${headBranch}`
    );
    const afterMedia = await captureScreenshotsForBranch(
      isTaskRunJwtAuth(auth)
        ? {
          workspaceDir,
          changedFiles,
          prTitle,
          prDescription,
          branch: headBranch,
          outputDir,
          auth: { taskRunJwt: auth.taskRunJwt },
          pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
          setupScript: options.setupScript,
          installCommand: options.installCommand,
          devCommand: options.devCommand,
          convexSiteUrl: options.convexSiteUrl,
        }
        : {
          workspaceDir,
          changedFiles,
          prTitle,
          prDescription,
          branch: headBranch,
          outputDir,
          auth: { anthropicApiKey: auth.anthropicApiKey },
          pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
          setupScript: options.setupScript,
          installCommand: options.installCommand,
          devCommand: options.devCommand,
          convexSiteUrl: options.convexSiteUrl,
        }
    );
    allScreenshots.push(...afterMedia.screenshots);
    allMedia.push(...afterMedia.media);
    if (afterMedia.hasUiChanges !== undefined) {
      hasUiChanges = afterMedia.hasUiChanges;
    }
    const afterImageCount = afterMedia.media.filter((m) => m.mediaType === "image").length;
    const afterVideoCount = afterMedia.media.filter((m) => m.mediaType === "video").length;
    await logToScreenshotCollector(
      `Captured 'after' media: ${afterImageCount} screenshots, ${afterVideoCount} videos`
    );

    const totalImages = allMedia.filter((m) => m.mediaType === "image").length;
    const totalVideos = allMedia.filter((m) => m.mediaType === "video").length;
    await logToScreenshotCollector(
      `Media capture completed. Total: ${totalImages} screenshots, ${totalVideos} videos saved to ${outputDir}`
    );
    log("INFO", "PR media capture completed", {
      screenshotCount: totalImages,
      videoCount: totalVideos,
      outputDir,
    });

    return {
      status: "completed",
      screenshots: allScreenshots,
      media: allMedia,
      hasUiChanges,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    await logToScreenshotCollector(`PR screenshot capture failed: ${message}`);
    log("ERROR", "PR screenshot capture failed", {
      error: message,
    });
    return {
      status: "failed",
      error: message,
    };
  }
}

// ============================================================================
// Video Recording Functions
// ============================================================================

/** Options for starting a video recording */
export interface StartVideoRecordingOptions {
  /** Output directory for the video file */
  outputDir?: string;
  /** Video filename (without extension) */
  fileName?: string;
  /** Description of what's being recorded */
  description?: string;
  /** X11 display to capture (defaults to :99) */
  display?: string;
}

/** Handle for an active video recording */
export interface ActiveVideoRecording {
  /** Stop the recording and get the result */
  stop: () => Promise<CapturedMedia>;
}

/** Internal state for tracking video recording process */
interface VideoRecordingState {
  ffmpegProcess: ReturnType<typeof import("node:child_process").spawn> | null;
  outputPath: string;
  startTime: number;
  description?: string;
}

let activeRecording: VideoRecordingState | null = null;

/**
 * Check if video recording is available (ffmpeg installed, X11 display available)
 */
export async function isVideoRecordingAvailable(): Promise<boolean> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);

  try {
    // Check if ffmpeg is available
    await execAsync("which ffmpeg");

    // Check if DISPLAY is set (for X11 capture)
    const display = process.env.DISPLAY || ":99";
    // Try to list X11 displays
    try {
      await execAsync(`xdpyinfo -display ${display} 2>&1 | head -1`);
    } catch {
      // Display check failed, but ffmpeg might still work with Xvfb
      await logToScreenshotCollector(
        `[WARN] X11 display ${display} check failed, video recording may not work`
      );
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Start recording video of the screen
 * Returns a handle that can be used to stop the recording
 */
export async function startVideoRecording(
  options: StartVideoRecordingOptions = {}
): Promise<ActiveVideoRecording> {
  const { spawn } = await import("node:child_process");

  if (activeRecording) {
    throw new Error("A video recording is already in progress. Stop it first.");
  }

  const outputDir = options.outputDir || SCREENSHOT_STORAGE_ROOT;
  const fileName = options.fileName || `video-${Date.now()}`;
  const display = options.display || process.env.DISPLAY || ":99";
  const outputPath = path.join(outputDir, `${fileName}.mp4`);

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  await logToScreenshotCollector(
    `Starting video recording: ${outputPath} (display: ${display})`
  );

  const ffmpegArgs = [
    "-y", // Overwrite output file
    "-f", "x11grab",
    "-video_size", "1920x1080",
    "-framerate", "30",
    "-i", display,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    outputPath,
  ];

  const ffmpegProcess = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  ffmpegProcess.stderr?.on("data", (data) => {
    stderr += data.toString();
  });

  // Store state
  activeRecording = {
    ffmpegProcess,
    outputPath,
    startTime: Date.now(),
    description: options.description,
  };

  // Handle process errors
  ffmpegProcess.on("error", (error) => {
    log("ERROR", "ffmpeg process error", { error: error.message });
    activeRecording = null;
  });

  // Give ffmpeg a moment to start
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Check if process is still running
  if (ffmpegProcess.exitCode !== null) {
    activeRecording = null;
    throw new Error(`ffmpeg failed to start: ${stderr}`);
  }

  return {
    stop: async (): Promise<CapturedMedia> => {
      if (!activeRecording) {
        throw new Error("No active recording to stop");
      }

      const { ffmpegProcess: proc, outputPath: outPath, startTime, description } = activeRecording;

      // Send SIGINT to stop recording gracefully
      proc?.kill("SIGINT");

      // Wait for process to finish
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          proc?.kill("SIGKILL");
          resolve();
        }, 5000);

        proc?.on("close", () => {
          clearTimeout(timeout);
          resolve();
        });

        proc?.on("error", reject);
      });

      activeRecording = null;

      const durationMs = Date.now() - startTime;

      await logToScreenshotCollector(
        `Video recording stopped: ${outPath} (duration: ${durationMs}ms)`
      );

      // Get actual video duration using ffprobe
      let actualDurationMs = durationMs;
      try {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);
        const { stdout } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outPath}"`
        );
        const seconds = parseFloat(stdout.trim());
        if (!isNaN(seconds)) {
          actualDurationMs = Math.round(seconds * 1000);
        }
      } catch {
        // Use estimated duration if ffprobe fails
      }

      return {
        path: outPath,
        description,
        mediaType: "video",
        durationMs: actualDurationMs,
      };
    },
  };
}

/**
 * Convenience function to record video for a specified duration
 */
export async function recordVideo(
  durationMs: number,
  options: StartVideoRecordingOptions = {}
): Promise<CapturedMedia> {
  const recording = await startVideoRecording(options);

  // Wait for the specified duration
  await new Promise((resolve) => setTimeout(resolve, durationMs));

  return recording.stop();
}

// Re-export utilities
export { logToScreenshotCollector } from "./logger";
export { formatClaudeMessage } from "./claudeMessageFormatter";

// CLI entry point - runs when executed directly
  const cliOptionsSchema = z.object({
    workspaceDir: z.string(),
    changedFiles: z.array(z.string()),
    prTitle: z.string(),
    prDescription: z.string(),
    baseBranch: z.string(),
    headBranch: z.string(),
    outputDir: z.string(),
    pathToClaudeCodeExecutable: z.string().optional(),
    setupScript: z.string().optional(),
    installCommand: z.string().optional(),
    devCommand: z.string().optional(),
    convexSiteUrl: z.string().optional(),
  auth: z.union([
    z.object({ taskRunJwt: z.string() }),
    z.object({ anthropicApiKey: z.string() }),
  ]),
});

async function main() {
  const optionsJson = process.env.SCREENSHOT_OPTIONS;
  if (!optionsJson) {
    console.error("SCREENSHOT_OPTIONS environment variable is required");
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(optionsJson);
  } catch (error) {
    console.error("Failed to parse SCREENSHOT_OPTIONS as JSON:", error);
    process.exit(1);
  }

  const validated = cliOptionsSchema.safeParse(parsed);
  if (!validated.success) {
    console.error("Invalid SCREENSHOT_OPTIONS:", validated.error.format());
    process.exit(1);
  }

  const options = validated.data;
  const result = await claudeCodeCapturePRScreenshots(options as CaptureScreenshotsOptions);

  // Output result as JSON to stdout
  console.log(JSON.stringify(result));
}

// Check if running as CLI (not imported as module)
// Only run as CLI if SCREENSHOT_OPTIONS env var is set - this is the definitive signal
// that we're being run as a CLI, not imported as a module
const shouldRunAsCli = !!process.env.SCREENSHOT_OPTIONS;

if (shouldRunAsCli) {
  main().catch((error) => {
    console.error("CLI execution failed:", error);
    process.exit(1);
  });
}
