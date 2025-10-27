import { startBrowserAgent } from "magnitude-core";

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { ACTION_FORMAT_PROMPT } from "../agentActionPrompt";
import { log } from "../logger";
import { runCommandCapture } from "../crown/utils";
import { filterTextFiles, parseFileList, resolveMergeBase } from "./git";
import {
  SCREENSHOT_COLLECTOR_DIRECTORY_URL,
  SCREENSHOT_COLLECTOR_LOG_PATH,
  logToScreenshotCollector,
} from "./logger";
import { readPrDescription } from "./context";
import { buildScreenshotPrompt, formatFileList } from "./prompt";
import { runScreenshotAnalysis } from "./analysis";

const INTERNAL_CDP_ENDPOINT = "http://127.0.0.1:39382";
const SCREENSHOT_OUTPUT_DIR = "/root/workspace/.cmux/screenshots";

export interface StartScreenshotCollectionOptions {
  openAiApiKey?: string | null;
  anthropicApiKey?: string | null;
  anthropicBaseUrl?: string | null;
  anthropicHeaders?: Record<string, string>;
  outputPath?: string;
}

export type ScreenshotCollectionResult =
  | { status: "completed"; screenshotPath: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

interface DevtoolsVersionResponse {
  webSocketDebuggerUrl: string;
}

function installAnthropicProxy(
  baseUrl: string,
  headers: Record<string, string>
): () => void {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const targetUrl = normalizedBase.endsWith("/v1/messages")
    ? normalizedBase
    : `${normalizedBase}/v1/messages`;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input, init) => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);

    if (requestUrl.startsWith("https://api.anthropic.com/v1/messages")) {
      const mergedHeaders = new Headers(init?.headers ?? {});
      Object.entries(headers).forEach(([key, value]) => {
        mergedHeaders.set(key, value);
      });

      if (input instanceof Request) {
        return originalFetch(
          new Request(targetUrl, {
            method: input.method,
            headers: mergedHeaders,
            body: input.body,
          })
        );
      }

      return originalFetch(targetUrl, {
        ...init,
        headers: mergedHeaders,
      });
    }

    return originalFetch(input, init);
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function fetchWebSocketUrl(endpoint: string): Promise<string> {
  const versionUrl = new URL("/json/version", endpoint);
  const response = await fetch(versionUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to load CDP version info (${response.status} ${response.statusText})`
    );
  }

  const payload = (await response.json()) as unknown;

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as Partial<DevtoolsVersionResponse>)
      .webSocketDebuggerUrl !== "string"
  ) {
    throw new Error("Invalid CDP version response (missing websocket URL)");
  }

  return (payload as DevtoolsVersionResponse).webSocketDebuggerUrl;
}

export async function startScreenshotCollection(
  options: StartScreenshotCollectionOptions = {}
): Promise<ScreenshotCollectionResult> {
  const restoreFetch =
    options.anthropicBaseUrl && options.anthropicBaseUrl.trim().length > 0
      ? installAnthropicProxy(
          options.anthropicBaseUrl,
          options.anthropicHeaders ?? {}
        )
      : null;

  let agent: Awaited<ReturnType<typeof startBrowserAgent>> | null = null;

  try {
    await logToScreenshotCollector("start-screenshot-collection triggered");
    log("INFO", "Screenshot collection trigger recorded", {
      path: SCREENSHOT_COLLECTOR_LOG_PATH,
      openVSCodeUrl: SCREENSHOT_COLLECTOR_DIRECTORY_URL,
    });

    const workspaceDir = "/root/workspace";

    await logToScreenshotCollector(
      "Determining merge base from origin HEAD branch..."
    );
    const { baseBranch, mergeBase } = await resolveMergeBase(workspaceDir);
    await logToScreenshotCollector(
      `Using merge base ${mergeBase} from ${baseBranch}`
    );

    const changedFilesOutput = await runCommandCapture(
      "git",
      ["diff", "--name-only", `${mergeBase}..HEAD`],
      { cwd: workspaceDir }
    );
    const changedFiles = parseFileList(changedFilesOutput);

    if (changedFiles.length === 0) {
      const reason = `No changes detected relative to ${baseBranch}`;
      await logToScreenshotCollector(reason);
      log("INFO", "No diff files detected for screenshot collection", {
        baseBranch,
        mergeBase,
      });
      return { status: "skipped", reason };
    }

    const textFiles = await filterTextFiles(
      workspaceDir,
      mergeBase,
      changedFiles
    );

    await logToScreenshotCollector(
      `Found ${textFiles.length} text file(s) with diffs out of ${changedFiles.length} total`
    );

    if (textFiles.length === 0) {
      const reason =
        "All changed files are binary; skipping screenshot collection";
      await logToScreenshotCollector("All changed files are binary; skipping");
      log("INFO", reason, {
        baseBranch,
        mergeBase,
        changedFiles,
      });
      return { status: "skipped", reason };
    }

    await logToScreenshotCollector(
      `Text files queued for screenshots: ${textFiles.join(", ")}`
    );
    const formattedFileList = formatFileList(textFiles);
    await logToScreenshotCollector(
      `Files included in screenshot prompt:\n${formattedFileList}`
    );
    log("INFO", "Changed text files identified for screenshot collection", {
      baseBranch,
      mergeBase,
      changedFiles,
      textFiles,
    });

    let prDescription: string | null = null;
    try {
      prDescription = await readPrDescription(workspaceDir);
      if (prDescription) {
        await logToScreenshotCollector(
          `PR description detected (${prDescription.length} characters)`
        );
      } else {
        await logToScreenshotCollector(
          "No PR description found; proceeding without additional context"
        );
      }
    } catch (descriptionError) {
      const message =
        descriptionError instanceof Error
          ? descriptionError.message
          : String(descriptionError ?? "unknown PR description error");
      await logToScreenshotCollector(
        `Failed to read PR description: ${message}`
      );
      log("ERROR", "Failed to read PR description for screenshots", {
        error: message,
      });
    }

    const suppliedOpenAiKey = options.openAiApiKey?.trim();
    const openAiApiKey =
      suppliedOpenAiKey && suppliedOpenAiKey.length > 0
        ? suppliedOpenAiKey
        : process.env.OPENAI_API_KEY;

    await logToScreenshotCollector(
      `OPENAI_API_KEY source: ${suppliedOpenAiKey ? "payload" : "environment"}`
    );
    await logToScreenshotCollector(
      `OPENAI_API_KEY (first 8 chars): ${
        openAiApiKey ? openAiApiKey.slice(0, 8) : "<none>"
      }`
    );

    if (!openAiApiKey) {
      const reason = "OPENAI_API_KEY is not configured for screenshot analysis";
      await logToScreenshotCollector(
        "OPENAI_API_KEY missing; skipping Codex screenshot instructions"
      );
      log("ERROR", reason, { baseBranch, mergeBase });
      return { status: "skipped", reason };
    }

    const suppliedAnthropicKey = options.anthropicApiKey?.trim();
    const anthropicApiKey =
      suppliedAnthropicKey && suppliedAnthropicKey.length > 0
        ? suppliedAnthropicKey
        : process.env.ANTHROPIC_API_KEY;

    await logToScreenshotCollector(
      `ANTHROPIC_API_KEY source: ${
        suppliedAnthropicKey ? "payload" : "environment"
      }`
    );
    await logToScreenshotCollector(
      `ANTHROPIC_API_KEY (first 8 chars): ${
        anthropicApiKey ? anthropicApiKey.slice(0, 8) : "<none>"
      }`
    );

    if (!anthropicApiKey && !options.anthropicBaseUrl) {
      const reason =
        "ANTHROPIC_API_KEY is not configured and no custom endpoint provided";
      await logToScreenshotCollector(
        "ANTHROPIC_API_KEY missing; cannot start Magnitude computer agent"
      );
      log("ERROR", reason, { baseBranch, mergeBase });
      return { status: "skipped", reason };
    }

    const prompt = buildScreenshotPrompt({
      baseBranch,
      mergeBase,
      formattedFileList,
      prDescription,
    });

    await logToScreenshotCollector(`Codex prompt:\n${prompt}`);

    const analysis = await runScreenshotAnalysis({
      apiKey: openAiApiKey,
      workspaceDir,
      prompt,
      logEvent: logToScreenshotCollector,
    });

    await logToScreenshotCollector(
      `Codex response: ${JSON.stringify(analysis)}`
    );
    log("INFO", "Codex screenshot analysis completed", {
      response: analysis,
      baseBranch,
      mergeBase,
    });

    if (!analysis.hasUiChanges) {
      const reason = "Codex detected no UI changes";
      await logToScreenshotCollector(
        "Codex detected no UI changes; skipping computer agent workflow"
      );
      return { status: "skipped", reason };
    }

    const screenshotInstructions =
      analysis.uiChangesToScreenshotInstructions.trim();

    if (screenshotInstructions.length === 0) {
      const reason =
        "Codex response did not include UI change instructions; skipping";
      await logToScreenshotCollector(reason);
      return { status: "skipped", reason };
    }

    await logToScreenshotCollector(
      `Launching Magnitude computer agent with claude-sonnet-4-5 via CDP at ${INTERNAL_CDP_ENDPOINT}`
    );
    await logToScreenshotCollector(
      `Computer agent instructions:\n${screenshotInstructions}`
    );

    let cdpWebSocketUrl: string;
    try {
      await logToScreenshotCollector("Resolving CDP WebSocket endpoint...");
      cdpWebSocketUrl = await fetchWebSocketUrl(INTERNAL_CDP_ENDPOINT);
      await logToScreenshotCollector(
        `CDP WebSocket endpoint resolved (${cdpWebSocketUrl})`
      );
    } catch (cdpError) {
      const message =
        cdpError instanceof Error
          ? cdpError.message
          : String(cdpError ?? "unknown CDP error");
      await logToScreenshotCollector(
        `Failed to resolve CDP WebSocket endpoint: ${message}`
      );
      log("ERROR", "Failed to resolve CDP WebSocket endpoint", {
        error: message,
      });
      return { status: "failed", error: message };
    }

    agent = await startBrowserAgent({
      llm: {
        provider: "anthropic",
        options: {
          model: "claude-sonnet-4-5",
          apiKey: anthropicApiKey ?? "cmux-internal",
        },
      },
      browser: {
        cdp: cdpWebSocketUrl,
      },
      prompt: ACTION_FORMAT_PROMPT,
    });

    try {
      await agent.act(screenshotInstructions);
      const outputPath =
        options.outputPath && options.outputPath.trim().length > 0
          ? options.outputPath
          : path.join(
              SCREENSHOT_OUTPUT_DIR,
              `cmux-screenshot-${Date.now()}.png`
            );
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await agent.page.screenshot({
        path: outputPath,
        type: "png",
        fullPage: true,
      });
      await logToScreenshotCollector(
        `Magnitude computer agent completed the UI change instructions; screenshot saved to ${outputPath}`
      );
      log("INFO", "Magnitude computer agent completed instructions", {
        baseBranch,
        mergeBase,
        outputPath,
      });
      return { status: "completed", screenshotPath: outputPath };
    } catch (agentError) {
      const message =
        agentError instanceof Error
          ? agentError.message
          : String(agentError ?? "unknown agent error");
      await logToScreenshotCollector(
        `Magnitude computer agent failed: ${message}`
      );
      log(
        "ERROR",
        "Magnitude computer agent failed to run UI change instructions",
        { error: message, baseBranch, mergeBase }
      );
      return { status: "failed", error: message };
    }
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    try {
      await logToScreenshotCollector(
        `start-screenshot-collection failed: ${reason}`
      );
    } catch (logError) {
      log("ERROR", "Failed to write screenshot collector error log", {
        error: logError instanceof Error ? logError.message : String(logError),
      });
    }
    log("ERROR", "Failed to record screenshot collection trigger", {
      path: SCREENSHOT_COLLECTOR_LOG_PATH,
      openVSCodeUrl: SCREENSHOT_COLLECTOR_DIRECTORY_URL,
      error: reason,
    });
    return { status: "failed", error: reason };
  } finally {
    if (agent) {
      try {
        await agent.stop();
      } catch (stopError) {
        log("ERROR", "Failed to stop Magnitude agent", {
          error:
            stopError instanceof Error ? stopError.message : String(stopError),
        });
      }
    }

    if (restoreFetch) {
      restoreFetch();
    }
  }
}
