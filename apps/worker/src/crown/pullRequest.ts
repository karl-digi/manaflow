import { z } from "zod";
import { log } from "../logger";
import { execAsync, WORKSPACE_ROOT } from "./utils";
import { convexRequest } from "./convex";
import type {
  CandidateData,
  CrownWorkerCheckResponse,
  PullRequestMetadata,
  WorkerRunContext,
} from "./types";

export function buildPullRequestTitle(prompt: string): string {
  const base = prompt.trim() || "cmux changes";
  const title = `[Crown] ${base}`;
  return title.length > 72 ? `${title.slice(0, 69)}...` : title;
}

export function buildPullRequestBody({
  summary,
  prompt,
  agentName,
  branch,
  taskId,
  runId,
  screenshots,
}: {
  summary?: string;
  prompt: string;
  agentName: string;
  branch: string;
  taskId: string;
  runId: string;
  screenshots?: ScreenshotSet[];
}): string {
  const bodySummary = summary?.trim() || "Summary not available.";

  let screenshotsSection = "";
  if (screenshots && screenshots.length > 0) {
    const latestScreenshotSet = screenshots[0];
    if (latestScreenshotSet.status === "completed" && latestScreenshotSet.images.length > 0) {
      screenshotsSection = "\n\n### Screenshots\n\n";

      for (const image of latestScreenshotSet.images) {
        if (image.url) {
          const fileName = image.fileName || "screenshot";
          screenshotsSection += `![${fileName}](${image.url})\n\n`;
        }
      }
    }
  }

  return `## 🏆 Crown Winner: ${agentName}

### Task Description
${prompt}

### Summary
${bodySummary}${screenshotsSection}

### Implementation Details
- **Agent**: ${agentName}
- **Task ID**: ${taskId}
- **Run ID**: ${runId}
- **Branch**: ${branch}
- **Created**: ${new Date().toISOString()}`;
}

function mapGhState(
  state: string | undefined
): "none" | "draft" | "open" | "merged" | "closed" | "unknown" {
  if (!state) return "unknown";
  const normalized = state.toLowerCase();
  if (
    normalized === "open" ||
    normalized === "closed" ||
    normalized === "merged"
  ) {
    return normalized;
  }
  return "unknown";
}

const ghPrCreateResponseSchema = z.object({
  url: z.url(),
  number: z
    .union([
      z.number().int(),
      z
        .string()
        .trim()
        .regex(/^[0-9]+$/)
        .transform(Number),
    ])
    .optional(),
  state: z.string().optional(),
  isDraft: z.boolean().optional(),
});

type GhPrCreateResponse = z.infer<typeof ghPrCreateResponseSchema>;

type ScreenshotImage = {
  storageId: string;
  mimeType: string;
  fileName?: string;
  url?: string;
};

type ScreenshotSet = {
  _id: string;
  status: "completed" | "failed" | "skipped";
  capturedAt: number;
  images: ScreenshotImage[];
  error?: string;
};

type GetScreenshotsResponse = {
  ok: boolean;
  screenshots: ScreenshotSet[];
};

function parseGhPrCreateResponse(input: unknown): GhPrCreateResponse | null {
  const result = ghPrCreateResponseSchema.safeParse(input);
  if (!result.success) {
    return null;
  }
  return result.data;
}

export async function createPullRequest(options: {
  check: CrownWorkerCheckResponse;
  winner: CandidateData;
  summary?: string;
  context: WorkerRunContext;
}): Promise<PullRequestMetadata | null> {
  const { check, winner, summary, context } = options;
  if (!check.task.autoPrEnabled) {
    return null;
  }

  const branch = winner.newBranch;
  if (!branch) {
    log("WARNING", "Skipping PR creation - winner branch missing", {
      taskId: check.taskId,
      runId: winner.runId,
    });
    return null;
  }

  // Fetch screenshots for the winner run
  let screenshots: ScreenshotSet[] = [];
  try {
    const screenshotResponse = await convexRequest<GetScreenshotsResponse>(
      "/api/screenshots/get-for-run",
      context.token,
      { runId: winner.runId },
      context.convexUrl
    );
    if (screenshotResponse?.ok && screenshotResponse.screenshots) {
      screenshots = screenshotResponse.screenshots;
      log("INFO", "Fetched screenshots for PR", {
        taskId: check.taskId,
        runId: winner.runId,
        count: screenshots.length,
      });
    }
  } catch (error) {
    log("WARNING", "Failed to fetch screenshots for PR", {
      taskId: check.taskId,
      runId: winner.runId,
      error,
    });
    // Continue without screenshots - don't fail PR creation
  }

  const baseBranch = check.task.baseBranch || "main";
  const prTitle = buildPullRequestTitle(check.task.text);
  const prBody = buildPullRequestBody({
    summary,
    prompt: check.task.text,
    agentName: winner.agentName,
    branch,
    taskId: context.taskId ?? check.taskId,
    runId: winner.runId,
    screenshots,
  });

  const script = `set -e
BODY_FILE=$(mktemp /tmp/cmux-pr-XXXXXX.md)
cat <<'CMUX_EOF' > "$BODY_FILE"
${prBody}
CMUX_EOF
gh pr create --base "$PR_BASE" --head "$PR_HEAD" --title "$PR_TITLE" --body-file "$BODY_FILE" --json url,number,state,isDraft
rm -f "$BODY_FILE"
`;

  try {
    const { stdout } = await execAsync(script, {
      cwd: WORKSPACE_ROOT,
      env: {
        ...process.env,
        PR_TITLE: prTitle,
        PR_BASE: baseBranch,
        PR_HEAD: branch,
      },
      maxBuffer: 5 * 1024 * 1024,
    });

    const trimmed = stdout.trim();
    if (!trimmed) {
      log("ERROR", "gh pr create returned empty output", {
        taskId: check.taskId,
        runId: winner.runId,
      });
      return null;
    }

    const parsed = parseGhPrCreateResponse(JSON.parse(trimmed));
    if (!parsed) {
      log("ERROR", "Failed to parse gh pr create output", {
        stdout: trimmed,
      });
      return null;
    }

    const metadata: PullRequestMetadata = {
      pullRequest: {
        url: parsed.url,
        number: parsed.number,
        state: mapGhState(parsed.state),
        isDraft: parsed.isDraft,
      },
      title: prTitle,
      description: prBody,
    };

    log("INFO", "Created pull request", {
      taskId: check.taskId,
      runId: winner.runId,
      url: parsed.url,
    });

    return metadata;
  } catch (error) {
    log("ERROR", "Failed to create pull request", {
      taskId: check.taskId,
      runId: winner.runId,
      error,
    });
    return null;
  }
}
