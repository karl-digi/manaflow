/**
 * Remote Screenshot Collector
 *
 * This module fetches the screenshot collector script from the www server
 * and executes it using bun. This allows updating the screenshot logic
 * without rebuilding the Morph worker image.
 */

import { exec as childExec } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

import { log } from "../logger";
import { logToScreenshotCollector } from "./logger";

const execAsync = promisify(childExec);

// The www server URL to fetch the script from
// In production, this will be the deployed www server
const WWW_BASE_URL =
  process.env.CMUX_WWW_URL ?? "https://www.cmux.dev";

const SCRIPT_NAME = "screenshot-collector";
const SCRIPT_CACHE_DIR = "/tmp/cmux-scripts";
const SCRIPT_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

interface ScriptResponse {
  script: string;
  version: string;
}

interface ScriptCacheEntry {
  content: string;
  version: string;
  fetchedAt: number;
}

let scriptCache: ScriptCacheEntry | null = null;

async function fetchRemoteScript(): Promise<ScriptCacheEntry> {
  // Check if cache is still valid
  if (
    scriptCache &&
    Date.now() - scriptCache.fetchedAt < SCRIPT_MAX_AGE_MS
  ) {
    log("DEBUG", "Using cached screenshot collector script", {
      version: scriptCache.version,
      cacheAge: Date.now() - scriptCache.fetchedAt,
    });
    return scriptCache;
  }

  const url = `${WWW_BASE_URL}/api/scripts/${SCRIPT_NAME}`;
  log("INFO", "Fetching remote screenshot collector script", { url });
  await logToScreenshotCollector(`Fetching script from ${url}`);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Failed to fetch screenshot collector script: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const data = (await response.json()) as ScriptResponse;

  if (!data.script || typeof data.script !== "string") {
    throw new Error("Invalid script response: missing script content");
  }

  const entry: ScriptCacheEntry = {
    content: data.script,
    version: data.version,
    fetchedAt: Date.now(),
  };

  scriptCache = entry;
  log("INFO", "Fetched screenshot collector script", {
    version: data.version,
    contentLength: data.script.length,
  });
  await logToScreenshotCollector(
    `Fetched script version ${data.version} (${data.script.length} bytes)`,
  );

  return entry;
}

async function writeScriptToFile(
  content: string,
  version: string,
): Promise<string> {
  await fs.mkdir(SCRIPT_CACHE_DIR, { recursive: true });

  const scriptPath = path.join(
    SCRIPT_CACHE_DIR,
    `screenshot-collector-${version}.ts`,
  );

  // Check if the file already exists with correct content
  try {
    const existing = await fs.readFile(scriptPath, "utf-8");
    if (existing === content) {
      log("DEBUG", "Script file already exists with correct content", {
        scriptPath,
      });
      return scriptPath;
    }
  } catch {
    // File doesn't exist, will create
  }

  await fs.writeFile(scriptPath, content, "utf-8");
  log("INFO", "Wrote screenshot collector script to file", { scriptPath });

  return scriptPath;
}

export interface RemoteScreenshotCollectorAuth {
  taskRunJwt?: string;
  anthropicApiKey?: string;
}

export interface RemoteScreenshotCollectorOptions {
  workspaceDir: string;
  changedFiles: string[];
  prTitle: string;
  prDescription: string;
  baseBranch: string;
  headBranch: string;
  outputDir: string;
  auth: RemoteScreenshotCollectorAuth;
  pathToClaudeCodeExecutable?: string;
  installCommand?: string;
  devCommand?: string;
}

export interface RemoteScreenshotCollectorResult {
  status: "completed" | "failed" | "skipped";
  screenshots?: { path: string; description?: string }[];
  hasUiChanges?: boolean;
  error?: string;
  reason?: string;
}

function parseResultFromOutput(output: string): RemoteScreenshotCollectorResult {
  // Look for the JSON result markers
  const startMarker = "---RESULT_JSON_START---";
  const endMarker = "---RESULT_JSON_END---";

  const startIndex = output.indexOf(startMarker);
  const endIndex = output.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    // Fallback: try to find JSON at the end
    const lines = output.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim();
      if (line?.startsWith("{")) {
        try {
          return JSON.parse(line) as RemoteScreenshotCollectorResult;
        } catch {
          // Not valid JSON, continue
        }
      }
    }

    throw new Error("Could not find result JSON in script output");
  }

  const jsonStr = output.slice(startIndex + startMarker.length, endIndex).trim();
  return JSON.parse(jsonStr) as RemoteScreenshotCollectorResult;
}

export async function runRemoteScreenshotCollector(
  options: RemoteScreenshotCollectorOptions,
): Promise<RemoteScreenshotCollectorResult> {
  try {
    // Fetch the script
    const scriptEntry = await fetchRemoteScript();

    // Write script to a temp file
    const scriptPath = await writeScriptToFile(
      scriptEntry.content,
      scriptEntry.version,
    );

    // Prepare options JSON
    const inputOptions = {
      workspaceDir: options.workspaceDir,
      changedFiles: options.changedFiles,
      prTitle: options.prTitle,
      prDescription: options.prDescription,
      baseBranch: options.baseBranch,
      headBranch: options.headBranch,
      outputDir: options.outputDir,
      auth: options.auth.taskRunJwt
        ? { taskRunJwt: options.auth.taskRunJwt }
        : { anthropicApiKey: options.auth.anthropicApiKey ?? "" },
      pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
      installCommand: options.installCommand,
      devCommand: options.devCommand,
    };

    const optionsJson = JSON.stringify(inputOptions);

    // Execute the script using bun
    log("INFO", "Executing remote screenshot collector script", {
      scriptPath,
      version: scriptEntry.version,
      workspaceDir: options.workspaceDir,
    });
    await logToScreenshotCollector(
      `Executing script version ${scriptEntry.version}`,
    );

    const command = `bun run "${scriptPath}" --options '${optionsJson.replace(/'/g, "'\\''")}'`;

    const { stdout, stderr } = await execAsync(command, {
      cwd: options.workspaceDir,
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for output
      env: {
        ...process.env,
        // These will be overridden by the script based on auth type
        HOME: process.env.HOME ?? "/root",
      },
      timeout: 30 * 60 * 1000, // 30 minute timeout
    });

    if (stderr) {
      log("DEBUG", "Screenshot collector stderr", {
        stderr: stderr.slice(0, 2000),
      });
    }

    // Parse the result from stdout
    const result = parseResultFromOutput(stdout);

    log("INFO", "Remote screenshot collector completed", {
      status: result.status,
      screenshotCount: result.screenshots?.length ?? 0,
      hasUiChanges: result.hasUiChanges,
    });

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    log("ERROR", "Remote screenshot collector failed", { error: message });
    await logToScreenshotCollector(
      `Remote screenshot collector failed: ${message}`,
    );
    return {
      status: "failed",
      error: message,
    };
  }
}
