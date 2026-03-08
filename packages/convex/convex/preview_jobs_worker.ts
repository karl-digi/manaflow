"use node";

import {
  createMorphCloudClient,
  startInstanceInstancePost,
  getInstanceInstanceInstanceIdGet,
  execInstanceInstanceIdExecPost,
  stopInstanceInstanceInstanceIdDelete,
  type InstanceModel,
} from "@cmux/morphcloud-openapi-client";
import { SignJWT } from "jose";
import { env } from "../_shared/convex-env";
import { fetchInstallationAccessToken } from "../_shared/githubApp";
import { stringToBase64 } from "../_shared/encoding";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

interface ScreenshotCollectorRelease {
  url: string;
  version: string;
  commitSha?: string;
}

const sliceOutput = (value?: string | null, length = 200): string | undefined =>
  value?.slice(0, length);

const singleQuote = (value: string): string =>
  `'${value.replace(/'/g, "'\\''")}'`;

const resolveConvexUrl = (): string | null => {
  const explicitUrl = process.env.CONVEX_SITE_URL || process.env.CONVEX_URL || process.env.CONVEX_CLOUD_URL;
  if (explicitUrl) {
    return explicitUrl.replace(/\/$/, "");
  }
  const deployment = process.env.CONVEX_DEPLOYMENT;
  if (deployment) {
    return `https://${deployment}.convex.site`;
  }
  return null;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Custom error thrown when a preview run has been superseded by a newer commit.
 * This is used to signal graceful early termination (not a failure).
 */
class SupersededError extends Error {
  constructor(
    public readonly previewRunId: Id<"previewRuns">,
    public readonly supersededBy?: Id<"previewRuns">,
    public readonly reason?: string,
  ) {
    super(`Preview run ${previewRunId} was superseded`);
    this.name = "SupersededError";
  }
}

/**
 * Fetch the screenshot collector release URL from Convex
 */
async function fetchScreenshotCollectorRelease({
  convexUrl,
  isStaging,
  previewRunId,
}: {
  convexUrl: string;
  isStaging: boolean;
  previewRunId: Id<"previewRuns">;
}): Promise<ScreenshotCollectorRelease> {
  // Use .site URL for HTTP endpoints
  const siteUrl = convexUrl.replace(".convex.cloud", ".convex.site");
  const endpoint = `${siteUrl}/api/host-screenshot-collector/latest?staging=${isStaging}`;

  console.log("[preview-jobs] Fetching screenshot collector release", {
    previewRunId,
    endpoint,
    isStaging,
  });

  const response = await fetch(endpoint);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch screenshot collector release (${response.status}): ${errorText}`
    );
  }

  const releaseInfo = await response.json() as ScreenshotCollectorRelease;
  if (!releaseInfo.url) {
    throw new Error("No URL in screenshot collector release info");
  }

  console.log("[preview-jobs] Found screenshot collector release", {
    previewRunId,
    version: releaseInfo.version,
    commitSha: releaseInfo.commitSha,
  });

  return releaseInfo;
}

interface ScreenshotCollectorOptions {
  workspaceDir: string;
  changedFiles: string[];
  prTitle: string;
  prDescription: string;
  baseBranch: string;
  headBranch: string;
  outputDir: string;
  pathToClaudeCodeExecutable?: string;
  setupScript?: string;
  installCommand?: string;
  devCommand?: string;
  convexSiteUrl?: string;
  auth: { taskRunJwt: string } | { anthropicApiKey: string };
}

interface ScreenshotCollectorResult {
  status: "completed" | "failed" | "skipped";
  screenshots?: Array<{ path: string; description?: string }>;
  videos?: Array<{ path: string; description?: string }>;
  hasUiChanges?: boolean;
  error?: string;
  reason?: string;
}

/**
 * Verify a file exists and is non-empty on Morph instance
 */
async function verifyFileOnMorph({
  morphClient,
  instanceId,
  filePath,
}: {
  morphClient: ReturnType<typeof createMorphCloudClient>;
  instanceId: string;
  filePath: string;
}): Promise<number> {
  const verifyResponse = await execInstanceInstanceIdExecPost({
    client: morphClient,
    path: { instance_id: instanceId },
    body: {
      command: ["stat", "-c", "%s", filePath],
    },
  });

  const fileSize = parseInt(verifyResponse.data?.stdout?.trim() || "0", 10);
  if (verifyResponse.error || verifyResponse.data?.exit_code !== 0 || fileSize === 0) {
    throw new Error(`File ${filePath} missing or empty: size=${fileSize}`);
  }
  return fileSize;
}

/**
 * Download a file from URL directly to Morph instance via curl
 */
async function downloadFileToMorph({
  morphClient,
  instanceId,
  filePath,
  url,
  previewRunId,
}: {
  morphClient: ReturnType<typeof createMorphCloudClient>;
  instanceId: string;
  filePath: string;
  url: string;
  previewRunId: Id<"previewRuns">;
}): Promise<number> {
  const downloadResponse = await execInstanceInstanceIdExecPost({
    client: morphClient,
    path: { instance_id: instanceId },
    body: {
      command: ["curl", "-fsSL", "-o", filePath, url],
    },
  });

  if (downloadResponse.error || downloadResponse.data?.exit_code !== 0) {
    throw new Error(
      `Failed to download file to ${filePath}: ${downloadResponse.data?.stderr || downloadResponse.error}`
    );
  }

  const fileSize = await verifyFileOnMorph({ morphClient, instanceId, filePath });

  console.log("[preview-jobs] File downloaded successfully", {
    previewRunId,
    filePath,
    fileSize,
  });

  return fileSize;
}

/**
 * Upload string content to Convex storage and return a URL for downloading
 */
async function uploadToStorage(
  ctx: ActionCtx,
  content: string,
  contentType = "text/plain",
): Promise<{ storageId: Id<"_storage">; url: string }> {
  const blob = new Blob([content], { type: contentType });
  const storageId = await ctx.storage.store(blob);
  const url = await ctx.storage.getUrl(storageId);
  if (!url) {
    throw new Error(`Failed to get URL for storage ID: ${storageId}`);
  }
  return { storageId, url };
}

/**
 * Write string content to a file on Morph instance by uploading to storage then downloading via curl
 */
async function writeStringToMorph({
  ctx,
  morphClient,
  instanceId,
  filePath,
  content,
  previewRunId,
  contentType = "text/plain",
}: {
  ctx: ActionCtx;
  morphClient: ReturnType<typeof createMorphCloudClient>;
  instanceId: string;
  filePath: string;
  content: string;
  previewRunId: Id<"previewRuns">;
  contentType?: string;
}): Promise<void> {
  // Upload content to Convex storage
  const { url, storageId } = await uploadToStorage(ctx, content, contentType);

  console.log("[preview-jobs] Uploaded content to storage", {
    previewRunId,
    filePath,
    contentLength: content.length,
    storageId,
  });

  // Download via curl on Morph
  const downloadResponse = await execInstanceInstanceIdExecPost({
    client: morphClient,
    path: { instance_id: instanceId },
    body: {
      command: ["curl", "-fsSL", "-o", filePath, url],
    },
  });

  if (downloadResponse.error || downloadResponse.data?.exit_code !== 0) {
    throw new Error(
      `Failed to download file to ${filePath}: ${downloadResponse.data?.stderr || downloadResponse.error}`
    );
  }

  const fileSize = await verifyFileOnMorph({ morphClient, instanceId, filePath });

  console.log("[preview-jobs] File written successfully via curl", {
    previewRunId,
    filePath,
    fileSize,
  });
}

/**
 * Read a file from Morph VM and return as base64
 */
async function readFileFromMorph({
  morphClient,
  instanceId,
  filePath,
}: {
  morphClient: ReturnType<typeof createMorphCloudClient>;
  instanceId: string;
  filePath: string;
}): Promise<{ base64: string; size: number } | null> {
  // Use base64 to read the file content (works for binary files like images)
  const response = await execInstanceInstanceIdExecPost({
    client: morphClient,
    path: { instance_id: instanceId },
    body: {
      command: ["base64", "-w", "0", filePath],
    },
  });

  if (response.error || response.data?.exit_code !== 0) {
    return null;
  }

  const base64 = response.data?.stdout?.trim() || "";
  if (!base64) {
    return null;
  }

  // Calculate approximate size from base64 length
  const size = Math.floor((base64.length * 3) / 4);
  return { base64, size };
}

/**
 * Get MIME type from file extension
 */
function getMimeTypeFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "apng":
      return "image/apng";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "mkv":
      return "video/x-matroska";
    default:
      return "application/octet-stream";
  }
}

/**
 * Download and run the screenshot collector via Morph exec
 */
async function runScreenshotCollector({
  ctx,
  morphClient,
  instanceId,
  collectorUrl,
  options,
  previewRunId,
}: {
  ctx: ActionCtx;
  morphClient: ReturnType<typeof createMorphCloudClient>;
  instanceId: string;
  collectorUrl: string;
  options: ScreenshotCollectorOptions;
  previewRunId: Id<"previewRuns">;
}): Promise<ScreenshotCollectorResult> {
  const collectorPath = "/tmp/screenshot-collector.mjs";
  const optionsPath = "/tmp/screenshot-options.json";
  const runScriptPath = "/tmp/screenshot-runner.mjs";

  // Step 1: Download the collector script from URL via curl on Morph
  console.log("[preview-jobs] Downloading screenshot collector", {
    previewRunId,
    collectorUrl,
  });

  await downloadFileToMorph({
    morphClient,
    instanceId,
    filePath: collectorPath,
    url: collectorUrl,
    previewRunId,
  });

  // Step 2: Write options JSON to Morph via curl (upload to storage, download on Morph)
  const optionsJson = JSON.stringify(options, null, 2);
  console.log("[preview-jobs] Writing screenshot options to file", {
    previewRunId,
    optionsLength: optionsJson.length,
  });

  await writeStringToMorph({
    ctx,
    morphClient,
    instanceId,
    filePath: optionsPath,
    content: optionsJson,
    previewRunId,
    contentType: "application/json",
  });

  // Step 3: Write the runner script to Morph via curl (upload to storage, download on Morph)
  const runScriptContent = `import { claudeCodeCapturePRScreenshots } from '${collectorPath}';
import { readFileSync } from 'fs';
const options = JSON.parse(readFileSync('${optionsPath}', 'utf-8'));
const result = await claudeCodeCapturePRScreenshots(options);
console.log(JSON.stringify(result));`;

  console.log("[preview-jobs] Writing runner script", {
    previewRunId,
    runScriptPath,
  });

  await writeStringToMorph({
    ctx,
    morphClient,
    instanceId,
    filePath: runScriptPath,
    content: runScriptContent,
    previewRunId,
    contentType: "application/javascript",
  });

  // Step 4: Execute the runner script
  console.log("[preview-jobs] Running screenshot collector", {
    previewRunId,
  });

  const runResponse = await execInstanceInstanceIdExecPost({
    client: morphClient,
    path: { instance_id: instanceId },
    body: {
      command: ["/root/.bun/bin/bun", "run", runScriptPath],
    },
  });

  if (runResponse.error) {
    throw new Error(`Screenshot collector exec error: ${JSON.stringify(runResponse.error)}`);
  }

  const { exit_code: exitCode, stdout, stderr } = runResponse.data || {};

  console.log("[preview-jobs] Screenshot collector completed", {
    previewRunId,
    exitCode,
    stdoutLength: stdout?.length,
    stderrLength: stderr?.length,
  });

  if (exitCode !== 0) {
    console.error("[preview-jobs] Screenshot collector failed", {
      previewRunId,
      exitCode,
      stderr: sliceOutput(stderr, 500),
      stdout: sliceOutput(stdout, 500),
    });
    return {
      status: "failed",
      error: stderr || stdout || `Collector exited with code ${exitCode}`,
    };
  }

  // Parse the JSON result from stdout
  // The collector outputs JSON on a line (look for lines starting with '{')
  // The wrapper script may add extra output after the collector finishes
  const stdoutLines = (stdout || "").split("\n").filter((line) => line.trim());

  if (stdoutLines.length === 0) {
    return {
      status: "failed",
      error: "No output from screenshot collector",
    };
  }

  // Find the JSON result line - it should start with '{'
  // Search from the end since the collector outputs JSON as its final meaningful output
  let jsonLine: string | null = null;
  for (let i = stdoutLines.length - 1; i >= 0; i--) {
    const line = stdoutLines[i].trim();
    if (line.startsWith("{")) {
      jsonLine = line;
      break;
    }
  }

  if (!jsonLine) {
    const lastLine = stdoutLines[stdoutLines.length - 1];
    console.error("[preview-jobs] No JSON output found from collector", {
      previewRunId,
      lastLine: sliceOutput(lastLine, 500),
      totalLines: stdoutLines.length,
      stdout: sliceOutput(stdout, 1000),
    });
    return {
      status: "failed",
      error: `No JSON output from collector. Last line: ${sliceOutput(lastLine, 200)}`,
    };
  }

  try {
    const result = JSON.parse(jsonLine) as ScreenshotCollectorResult;
    // Log full stdout when no screenshots captured for debugging
    if (!result.screenshots || result.screenshots.length === 0) {
      console.log("[preview-jobs] Collector returned 0 screenshots, showing logs", {
        previewRunId,
        status: result.status,
        hasUiChanges: result.hasUiChanges,
        error: result.error,
        reason: result.reason,
        // Show last 50 lines of stdout for debugging
        stdoutTail: stdoutLines.slice(-50).join("\n"),
      });
    }
    return result;
  } catch {
    console.error("[preview-jobs] Failed to parse collector JSON output", {
      previewRunId,
      jsonLine: sliceOutput(jsonLine, 500),
    });
    return {
      status: "failed",
      error: `Failed to parse collector output: ${sliceOutput(jsonLine, 200)}`,
    };
  }
}

async function waitForInstanceReady(
  morphClient: ReturnType<typeof createMorphCloudClient>,
  instanceId: string,
  readinessTimeoutMs = 5 * 60 * 1000,
): Promise<InstanceModel> {
  const start = Date.now();
  while (true) {
    const response = await getInstanceInstanceInstanceIdGet({
      client: morphClient,
      path: { instance_id: instanceId },
    });

    if (response.error) {
      throw new Error(`Failed to get instance status: ${JSON.stringify(response.error)}`);
    }

    const instance = response.data;
    if (!instance) {
      throw new Error("Instance data missing from response");
    }

    if (instance.status === "ready") {
      return instance;
    }
    if (instance.status === "error") {
      throw new Error("Morph instance entered error state");
    }
    if (Date.now() - start > readinessTimeoutMs) {
      throw new Error("Morph instance did not become ready before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function startMorphInstance(
  morphClient: ReturnType<typeof createMorphCloudClient>,
  options: {
    snapshotId: string;
    metadata?: Record<string, string>;
    ttlSeconds?: number;
    ttlAction?: "stop" | "pause";
    readinessTimeoutMs?: number;
  },
): Promise<InstanceModel> {
  const response = await startInstanceInstancePost({
    client: morphClient,
    query: {
      snapshot_id: options.snapshotId,
    },
    body: {
      metadata: options.metadata,
      ttl_seconds: options.ttlSeconds,
      ttl_action: options.ttlAction,
    },
  });

  if (response.error) {
    throw new Error(`Failed to start instance: ${JSON.stringify(response.error)}`);
  }

  const instance = response.data;
  if (!instance) {
    throw new Error("Instance data missing from start response");
  }

  return await waitForInstanceReady(
    morphClient,
    instance.id,
    options.readinessTimeoutMs,
  );
}

async function stopMorphInstance(
  morphClient: ReturnType<typeof createMorphCloudClient>,
  instanceId: string,
) {
  await stopInstanceInstanceInstanceIdDelete({
    client: morphClient,
    path: { instance_id: instanceId },
  });
}

// ============================================================================
// PVE-LXC Support - uses www app as proxy
// ============================================================================

/**
 * HTTP service exposed by PVE-LXC container
 */
interface PveLxcHttpService {
  name: string;
  port: number;
  url: string;
}

/**
 * PVE-LXC instance info returned from www proxy
 */
interface PveLxcInstanceInfo {
  instanceId: string;
  vmid: number;
  status: string;
  networking: {
    httpServices: PveLxcHttpService[];
    hostname?: string;
    fqdn?: string;
  };
}

/**
 * Exec result from PVE-LXC
 */
interface PveLxcExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

/**
 * Start a PVE-LXC instance via www proxy endpoint
 */
async function startPveLxcInstance(options: {
  snapshotId: string;
  templateVmid?: number;
  metadata?: Record<string, string>;
  ttlSeconds?: number;
  ttlAction?: "stop" | "pause";
  readinessTimeoutMs?: number;
}): Promise<PveLxcInstanceInfo> {
  const baseUrl = env.BASE_APP_URL;
  const apiKey = env.CMUX_TASK_RUN_JWT_SECRET;

  if (!baseUrl) {
    throw new Error("BASE_APP_URL not configured for PVE-LXC");
  }
  if (!apiKey) {
    throw new Error("CMUX_TASK_RUN_JWT_SECRET not configured for PVE-LXC");
  }

  const response = await fetch(`${baseUrl}/api/pve-lxc/preview/instances/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      snapshotId: options.snapshotId,
      templateVmid: options.templateVmid,
      metadata: options.metadata,
      ttlSeconds: options.ttlSeconds,
      ttlAction: options.ttlAction,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to start PVE-LXC instance (${response.status}): ${errorText}`);
  }

  const instance = await response.json() as PveLxcInstanceInfo;

  // Wait for instance to be ready (PVE-LXC containers start quickly, but we still poll)
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 5 * 60 * 1000;
  const start = Date.now();
  const pollIntervalMs = 2000;

  // PVE-LXC containers are typically ready immediately, but exec daemon may need time to start
  // Try a simple exec command to verify readiness
  while (Date.now() - start < readinessTimeoutMs) {
    try {
      const testResult = await execPveLxcInstance(instance.instanceId, "echo ready");
      if (testResult.exit_code === 0 && testResult.stdout.includes("ready")) {
        return instance;
      }
    } catch (pollError) {
      // Exec daemon not ready yet - this is expected during startup, continue polling
      console.log("[preview-jobs] PVE-LXC exec not ready yet, continuing to poll", {
        instanceId: instance.instanceId,
        elapsedMs: Date.now() - start,
        error: pollError instanceof Error ? pollError.message : String(pollError),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("PVE-LXC instance did not become ready before timeout");
}

/**
 * Execute a command in a PVE-LXC instance via www proxy endpoint
 */
async function execPveLxcInstance(
  instanceId: string,
  command: string,
  options?: { timeoutMs?: number }
): Promise<PveLxcExecResult> {
  const baseUrl = env.BASE_APP_URL;
  const apiKey = env.CMUX_TASK_RUN_JWT_SECRET;

  if (!baseUrl) {
    throw new Error("BASE_APP_URL not configured for PVE-LXC exec");
  }
  if (!apiKey) {
    throw new Error("CMUX_TASK_RUN_JWT_SECRET not configured for PVE-LXC exec");
  }

  const response = await fetch(
    `${baseUrl}/api/pve-lxc/preview/instances/${encodeURIComponent(instanceId)}/exec`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        command,
        timeoutMs: options?.timeoutMs,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to exec in PVE-LXC instance (${response.status}): ${errorText}`);
  }

  return await response.json() as PveLxcExecResult;
}

/**
 * Stop a PVE-LXC instance via www proxy endpoint
 */
async function stopPveLxcInstance(instanceId: string): Promise<void> {
  const baseUrl = env.BASE_APP_URL;
  const apiKey = env.CMUX_TASK_RUN_JWT_SECRET;

  if (!baseUrl) {
    throw new Error("BASE_APP_URL not configured for PVE-LXC stop");
  }
  if (!apiKey) {
    throw new Error("CMUX_TASK_RUN_JWT_SECRET not configured for PVE-LXC stop");
  }

  const response = await fetch(
    `${baseUrl}/api/pve-lxc/preview/instances/${encodeURIComponent(instanceId)}`,
    {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to stop PVE-LXC instance (${response.status}): ${errorText}`);
  }
}

/**
 * Read a file from a PVE-LXC instance via www proxy endpoint
 */
async function readFileFromPveLxc(options: {
  instanceId: string;
  filePath: string;
}): Promise<{ base64: string; size: number } | null> {
  const baseUrl = env.BASE_APP_URL;
  const apiKey = env.CMUX_TASK_RUN_JWT_SECRET;

  if (!baseUrl || !apiKey) {
    return null;
  }

  try {
    const response = await fetch(
      `${baseUrl}/api/pve-lxc/preview/instances/${encodeURIComponent(options.instanceId)}/read-file`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          filePath: options.filePath,
        }),
      }
    );

    if (!response.ok) {
      return null;
    }

    return await response.json() as { base64: string; size: number };
  } catch (readError) {
    // File read failures are expected for non-existent files - return null for graceful handling
    console.log("[preview-jobs] Failed to read file from PVE-LXC (may not exist)", {
      instanceId: options.instanceId,
      filePath: options.filePath,
      error: readError instanceof Error ? readError.message : String(readError),
    });
    return null;
  }
}

// ============================================================================
// Unified Instance Types for Provider Abstraction
// ============================================================================

/**
 * Unified HTTP service info (works for both Morph and PVE-LXC)
 */
interface UnifiedHttpService {
  port: number;
  url: string;
}

/**
 * Unified instance info that works for both Morph and PVE-LXC
 */
interface UnifiedInstance {
  id: string;
  provider: "morph" | "pve-lxc";
  httpServices: UnifiedHttpService[];
}

/**
 * Unified exec result
 */
interface UnifiedExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  error?: unknown;
}

/**
 * Provider-agnostic exec function type
 */
type ExecFn = (command: string[] | string) => Promise<UnifiedExecResult>;

/**
 * Provider-agnostic stop function type
 */
type StopFn = () => Promise<void>;

/**
 * Provider-agnostic file read function type
 */
type ReadFileFn = (filePath: string) => Promise<{ base64: string; size: number } | null>;

/**
 * Convert Morph instance to unified format
 */
function toUnifiedInstance(morph: InstanceModel): UnifiedInstance {
  return {
    id: morph.id,
    provider: "morph",
    httpServices: (morph.networking?.http_services ?? []).map((s) => ({
      port: s.port ?? 0,
      url: s.url ?? "",
    })),
  };
}

/**
 * Convert PVE-LXC instance to unified format
 */
function pveLxcToUnifiedInstance(pve: PveLxcInstanceInfo): UnifiedInstance {
  return {
    id: pve.instanceId,
    provider: "pve-lxc",
    httpServices: pve.networking.httpServices.map((s) => ({
      port: s.port,
      url: s.url,
    })),
  };
}

/**
 * Create exec function for Morph
 */
function createMorphExecFn(
  morphClient: ReturnType<typeof createMorphCloudClient>,
  instanceId: string
): ExecFn {
  return async (command: string[] | string): Promise<UnifiedExecResult> => {
    const cmd = Array.isArray(command) ? command : ["bash", "-lc", command];
    const response = await execInstanceInstanceIdExecPost({
      client: morphClient,
      path: { instance_id: instanceId },
      body: { command: cmd },
    });
    return {
      exit_code: response.data?.exit_code ?? -1,
      stdout: response.data?.stdout ?? "",
      stderr: response.data?.stderr ?? "",
      error: response.error,
    };
  };
}

/**
 * Create exec function for PVE-LXC
 */
function createPveLxcExecFn(instanceId: string): ExecFn {
  return async (command: string[] | string): Promise<UnifiedExecResult> => {
    // PVE-LXC exec takes a single command string
    const cmd = Array.isArray(command) ? command.join(" ") : command;
    try {
      const result = await execPveLxcInstance(instanceId, cmd);
      return {
        exit_code: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      return {
        exit_code: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        error,
      };
    }
  };
}

// ============================================================================
// Provider-Agnostic Helper Functions (using ExecFn)
// ============================================================================

/**
 * Check if repo has a commit (provider-agnostic version)
 */
async function repoHasCommitWithExecFn({
  execFn,
  repoDir,
  commitSha,
  previewRunId,
}: {
  execFn: ExecFn;
  repoDir: string;
  commitSha: string;
  previewRunId: Id<"previewRuns">;
}): Promise<boolean> {
  const response = await execFn(["git", "-C", repoDir, "cat-file", "-e", `${commitSha}^{commit}`]);

  if (response.error) {
    console.warn("[preview-jobs] Failed to check commit availability", {
      previewRunId,
      commitSha,
      error: response.error,
    });
    return false;
  }

  return response.exit_code === 0;
}

/**
 * Ensure commit is available in repo (provider-agnostic version)
 */
async function ensureCommitAvailableWithExecFn({
  execFn,
  repoDir,
  commitSha,
  prNumber,
  previewRunId,
  headRepoCloneUrl,
  headRef,
}: {
  execFn: ExecFn;
  repoDir: string;
  commitSha: string;
  prNumber: number;
  previewRunId: Id<"previewRuns">;
  headRepoCloneUrl?: string;
  headRef?: string;
}): Promise<void> {
  if (await repoHasCommitWithExecFn({ execFn, repoDir, commitSha, previewRunId })) {
    return;
  }

  console.warn("[preview-jobs] Commit missing after initial fetch, attempting targeted fetches", {
    previewRunId,
    commitSha,
    prNumber,
    headRepoCloneUrl,
    headRef,
  });

  const fetchAttempts: Array<{
    description: string;
    command: string[];
  }> = [
    {
      description: "fetch commit by sha",
      command: ["git", "-C", repoDir, "fetch", "origin", commitSha],
    },
    {
      description: "fetch PR head ref",
      command: [
        "git",
        "-C",
        repoDir,
        "fetch",
        "origin",
        `+refs/pull/${prNumber}/head:refs/cmux/preview/pull/${prNumber}`,
      ],
    },
  ];

  // If PR is from a fork, add fork fetch as the highest priority
  if (headRepoCloneUrl && headRef) {
    fetchAttempts.unshift({
      description: "fetch from fork repository",
      command: [
        "git",
        "-C",
        repoDir,
        "fetch",
        headRepoCloneUrl,
        `${headRef}:refs/cmux/preview/fork/${prNumber}`,
      ],
    });
  }

  for (const attempt of fetchAttempts) {
    console.log("[preview-jobs] Targeted fetch attempt", {
      previewRunId,
      commitSha,
      prNumber,
      description: attempt.description,
    });

    const fetchResponse = await execFn(attempt.command);

    if (fetchResponse.error || fetchResponse.exit_code !== 0) {
      console.warn("[preview-jobs] Targeted fetch failed", {
        previewRunId,
        commitSha,
        prNumber,
        description: attempt.description,
        exitCode: fetchResponse.exit_code,
        stderr: sliceOutput(fetchResponse.stderr),
        stdout: sliceOutput(fetchResponse.stdout),
        error: fetchResponse.error,
      });
      continue;
    }

    if (await repoHasCommitWithExecFn({ execFn, repoDir, commitSha, previewRunId })) {
      console.log("[preview-jobs] Commit available after targeted fetch", {
        previewRunId,
        commitSha,
        prNumber,
        description: attempt.description,
      });
      return;
    }
  }

  throw new Error(
    `Commit ${commitSha} is unavailable after targeted fetch attempts for PR #${prNumber}`,
  );
}

/**
 * Stash local changes before checkout (provider-agnostic version)
 */
async function stashLocalChangesWithExecFn({
  execFn,
  repoDir,
  previewRunId,
  headSha,
}: {
  execFn: ExecFn;
  repoDir: string;
  previewRunId: Id<"previewRuns">;
  headSha: string;
}): Promise<void> {
  console.log("[preview-jobs] Stashing local changes before checkout", {
    previewRunId,
    repoDir,
    headSha,
  });

  const stashResponse = await execFn([
    "git",
    "-C",
    repoDir,
    "stash",
    "push",
    "--include-untracked",
    "--message",
    `cmux-preview auto-stash before checkout ${headSha}`,
  ]);

  if (stashResponse.error) {
    console.error("[preview-jobs] Failed to stash changes before checkout", {
      previewRunId,
      headSha,
      error: stashResponse.error,
    });
    throw new Error("Failed to stash local changes before checkout");
  }

  if (stashResponse.exit_code !== 0) {
    console.error("[preview-jobs] Stash command failed", {
      previewRunId,
      headSha,
      exitCode: stashResponse.exit_code,
      stdout: sliceOutput(stashResponse.stdout),
      stderr: sliceOutput(stashResponse.stderr),
    });
    throw new Error(
      `Failed to stash local changes before checkout (exit ${stashResponse.exit_code}): stderr="${sliceOutput(
        stashResponse.stderr,
      )}" stdout="${sliceOutput(stashResponse.stdout)}"`,
    );
  }

  console.log("[preview-jobs] Stash completed before checkout", {
    previewRunId,
    headSha,
    stdout: sliceOutput(stashResponse.stdout),
    stderr: sliceOutput(stashResponse.stderr),
  });
}

/**
 * Get changed files in the PR (provider-agnostic version)
 */
async function getChangedFilesWithExecFn({
  execFn,
  repoDir,
  baseBranch,
  baseSha,
  previewRunId,
}: {
  execFn: ExecFn;
  repoDir: string;
  baseBranch: string;
  baseSha?: string;
  previewRunId: Id<"previewRuns">;
}): Promise<string[]> {
  // Strategy 1: Use baseSha directly if available (most reliable for PRs)
  if (baseSha) {
    console.log("[preview-jobs] Attempting to get changed files using baseSha", {
      previewRunId,
      baseSha,
    });

    const baseShaResponse = await execFn(["git", "-C", repoDir, "diff", "--name-only", `${baseSha}..HEAD`]);

    if (!baseShaResponse.error && baseShaResponse.exit_code === 0) {
      const changedFiles = (baseShaResponse.stdout || "")
        .split("\n")
        .map((f) => f.trim())
        .filter((f) => f.length > 0);

      console.log("[preview-jobs] Got changed files using baseSha", {
        previewRunId,
        baseSha,
        fileCount: changedFiles.length,
        files: changedFiles.slice(0, 10),
      });

      return changedFiles;
    }

    console.warn("[preview-jobs] Failed to diff against baseSha, trying merge-base approach", {
      previewRunId,
      baseSha,
      exitCode: baseShaResponse.exit_code,
      stderr: sliceOutput(baseShaResponse.stderr),
    });
  }

  // Strategy 2: Get the merge base with origin/baseBranch
  const mergeBaseResponse = await execFn(["git", "-C", repoDir, "merge-base", `origin/${baseBranch}`, "HEAD"]);

  if (!mergeBaseResponse.error && mergeBaseResponse.exit_code === 0) {
    const mergeBase = mergeBaseResponse.stdout?.trim();
    if (mergeBase) {
      // Get changed files between merge base and HEAD
      const diffResponse = await execFn(["git", "-C", repoDir, "diff", "--name-only", `${mergeBase}..HEAD`]);

      if (!diffResponse.error && diffResponse.exit_code === 0) {
        const changedFiles = (diffResponse.stdout || "")
          .split("\n")
          .map((f) => f.trim())
          .filter((f) => f.length > 0);

        console.log("[preview-jobs] Got changed files using merge-base", {
          previewRunId,
          mergeBase,
          fileCount: changedFiles.length,
          files: changedFiles.slice(0, 10),
        });

        return changedFiles;
      }

      console.warn("[preview-jobs] Failed to diff against merge-base", {
        previewRunId,
        mergeBase,
        exitCode: diffResponse.exit_code,
        stderr: sliceOutput(diffResponse.stderr),
      });
    }
  } else {
    console.warn("[preview-jobs] Failed to get merge base, trying direct origin diff", {
      previewRunId,
      exitCode: mergeBaseResponse.exit_code,
      stderr: sliceOutput(mergeBaseResponse.stderr),
    });
  }

  // Strategy 3: Fallback - diff against origin/baseBranch directly
  const fallbackResponse = await execFn(["git", "-C", repoDir, "diff", "--name-only", `origin/${baseBranch}`]);

  if (!fallbackResponse.error && fallbackResponse.exit_code === 0) {
    const changedFiles = (fallbackResponse.stdout || "")
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    console.log("[preview-jobs] Got changed files using direct origin diff", {
      previewRunId,
      baseBranch,
      fileCount: changedFiles.length,
      files: changedFiles.slice(0, 10),
    });

    return changedFiles;
  }

  // Strategy 4: All approaches failed - return empty array for graceful degradation
  console.warn("[preview-jobs] All changed file detection strategies failed, returning empty array", {
    previewRunId,
    baseSha,
    baseBranch,
    lastExitCode: fallbackResponse.exit_code,
    lastStderr: sliceOutput(fallbackResponse.stderr),
  });

  return [];
}

/**
 * Run the screenshot collector (provider-agnostic version using ExecFn)
 */
async function runScreenshotCollectorWithExecFn({
  execFn,
  collectorUrl,
  options,
  previewRunId,
}: {
  execFn: ExecFn;
  collectorUrl: string;
  options: ScreenshotCollectorOptions;
  previewRunId: Id<"previewRuns">;
}): Promise<ScreenshotCollectorResult> {
  const collectorPath = "/tmp/screenshot-collector.mjs";
  const optionsPath = "/tmp/screenshot-options.json";
  const runScriptPath = "/tmp/screenshot-runner.mjs";

  // Step 1: Download the collector script from URL via curl
  console.log("[preview-jobs] Downloading screenshot collector", {
    previewRunId,
    collectorUrl,
  });

  const downloadResult = await execFn(`curl -fsSL -o '${collectorPath}' '${collectorUrl}'`);
  if (downloadResult.error || downloadResult.exit_code !== 0) {
    console.error("[preview-jobs] Failed to download collector", {
      previewRunId,
      exitCode: downloadResult.exit_code,
      stderr: sliceOutput(downloadResult.stderr),
    });
    return {
      status: "failed",
      error: `Failed to download collector: ${downloadResult.stderr || "unknown error"}`,
    };
  }

  // Step 2: Write options JSON file
  const optionsJson = JSON.stringify(options, null, 2);
  console.log("[preview-jobs] Writing screenshot options to file", {
    previewRunId,
    optionsLength: optionsJson.length,
  });

  // Use heredoc to write the JSON file
  const writeOptionsResult = await execFn(`cat > '${optionsPath}' <<'OPTIONS_EOF'
${optionsJson}
OPTIONS_EOF`);
  if (writeOptionsResult.error || writeOptionsResult.exit_code !== 0) {
    console.error("[preview-jobs] Failed to write options", {
      previewRunId,
      exitCode: writeOptionsResult.exit_code,
      stderr: sliceOutput(writeOptionsResult.stderr),
    });
    return {
      status: "failed",
      error: `Failed to write options: ${writeOptionsResult.stderr || "unknown error"}`,
    };
  }

  // Step 3: Write the runner script
  const runScriptContent = `import { claudeCodeCapturePRScreenshots } from '${collectorPath}';
import { readFileSync } from 'fs';
const options = JSON.parse(readFileSync('${optionsPath}', 'utf-8'));
const result = await claudeCodeCapturePRScreenshots(options);
console.log(JSON.stringify(result));`;

  console.log("[preview-jobs] Writing runner script", {
    previewRunId,
    runScriptPath,
  });

  const writeRunnerResult = await execFn(`cat > '${runScriptPath}' <<'RUNNER_EOF'
${runScriptContent}
RUNNER_EOF`);
  if (writeRunnerResult.error || writeRunnerResult.exit_code !== 0) {
    console.error("[preview-jobs] Failed to write runner script", {
      previewRunId,
      exitCode: writeRunnerResult.exit_code,
      stderr: sliceOutput(writeRunnerResult.stderr),
    });
    return {
      status: "failed",
      error: `Failed to write runner: ${writeRunnerResult.stderr || "unknown error"}`,
    };
  }

  // Step 4: Execute the runner script
  console.log("[preview-jobs] Running screenshot collector", {
    previewRunId,
  });

  const runResponse = await execFn(["/root/.bun/bin/bun", "run", runScriptPath]);

  const { exit_code: exitCode, stdout, stderr } = runResponse;

  console.log("[preview-jobs] Screenshot collector completed", {
    previewRunId,
    exitCode,
    stdoutLength: stdout?.length,
    stderrLength: stderr?.length,
  });

  if (exitCode !== 0) {
    console.error("[preview-jobs] Screenshot collector failed", {
      previewRunId,
      exitCode,
      stderr: sliceOutput(stderr, 500),
      stdout: sliceOutput(stdout, 500),
    });
    return {
      status: "failed",
      error: stderr || stdout || `Collector exited with code ${exitCode}`,
    };
  }

  // Parse the JSON result from stdout
  const stdoutLines = (stdout || "").split("\n").filter((line) => line.trim());

  if (stdoutLines.length === 0) {
    return {
      status: "failed",
      error: "No output from screenshot collector",
    };
  }

  // Find the JSON result line - search from the end
  let jsonLine: string | null = null;
  for (let i = stdoutLines.length - 1; i >= 0; i--) {
    const line = stdoutLines[i].trim();
    if (line.startsWith("{")) {
      jsonLine = line;
      break;
    }
  }

  if (!jsonLine) {
    const lastLine = stdoutLines[stdoutLines.length - 1];
    console.error("[preview-jobs] No JSON output found from collector", {
      previewRunId,
      lastLine: sliceOutput(lastLine, 500),
      totalLines: stdoutLines.length,
      stdout: sliceOutput(stdout, 1000),
    });
    return {
      status: "failed",
      error: `No JSON output from collector. Last line: ${sliceOutput(lastLine, 200)}`,
    };
  }

  try {
    const result = JSON.parse(jsonLine) as ScreenshotCollectorResult;
    // Log full stdout when no screenshots captured for debugging
    if (!result.screenshots || result.screenshots.length === 0) {
      console.log("[preview-jobs] Collector returned 0 screenshots, showing logs", {
        previewRunId,
        status: result.status,
        hasUiChanges: result.hasUiChanges,
        error: result.error,
        reason: result.reason,
        stdoutTail: stdoutLines.slice(-50).join("\n"),
      });
    }
    return result;
  } catch {
    console.error("[preview-jobs] Failed to parse collector JSON output", {
      previewRunId,
      jsonLine: sliceOutput(jsonLine, 500),
    });
    return {
      status: "failed",
      error: `Failed to parse collector output: ${sliceOutput(jsonLine, 200)}`,
    };
  }
}

/**
 * Ensure tmux session exists (provider-agnostic version)
 */
async function ensureTmuxSessionWithExecFn({
  execFn,
  repoDir,
  previewRunId,
}: {
  execFn: ExecFn;
  repoDir: string;
  previewRunId: Id<"previewRuns">;
}): Promise<void> {
  // Match the orchestrator: create session with -n main for the initial window
  const sessionCmd = `tmux has-session -t cmux 2>/dev/null || tmux new-session -d -s cmux -c ${singleQuote(repoDir)} -n main`;
  const response = await execFn(sessionCmd);
  if (response.error || response.exit_code !== 0) {
    console.warn("[preview-jobs] Failed to ensure tmux session", {
      previewRunId,
      exitCode: response.exit_code,
      stdout: sliceOutput(response.stdout),
      stderr: sliceOutput(response.stderr),
      error: response.error,
    });
  }
}

/**
 * Run a script in a tmux window (provider-agnostic version)
 */
async function runScriptInTmuxWindowWithExecFn({
  execFn,
  repoDir,
  windowName,
  scriptContent,
  previewRunId,
  useSetE = true,
}: {
  execFn: ExecFn;
  repoDir: string;
  windowName: string;
  scriptContent: string;
  previewRunId: Id<"previewRuns">;
  useSetE?: boolean;
}): Promise<void> {
  const trimmed = scriptContent.trim();
  if (!trimmed) {
    return;
  }

  // Create script wrapper matching the environment orchestrator format
  const setFlags = useSetE ? "set -eux" : "set -ux";
  const wrappedScript = `#!/bin/zsh
${setFlags}

# Source system profile for environment variables (RUSTUP_HOME, etc.)
[[ -f /etc/profile ]] && source /etc/profile

cd ${repoDir}

echo "=== ${windowName} Script Started at $(date) ==="
${trimmed}
${useSetE ? `echo "=== ${windowName} Script Completed at $(date) ==="` : ""}
`;

  const runtimeDir = "/var/tmp/cmux-scripts";
  const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const scriptFilePath = `${runtimeDir}/${windowName}.sh`;
  const launcherScriptPath = `${runtimeDir}/${windowName}-launcher.sh`;
  const logFilePath = `${runtimeDir}/${windowName}_${runId}.log`;
  const exitCodePath = `${runtimeDir}/${windowName}_${runId}.exit-code`;

  // Create a launcher script
  const launcherScript = `#!/bin/zsh
set -eu

# Create the tmux window
tmux new-window -t cmux: -n '${windowName}' -d

# Send keys to run the script
tmux send-keys -t cmux:'${windowName}' "zsh '${scriptFilePath}' 2>&1 | tee '${logFilePath}'; echo \\\${pipestatus[1]} > '${exitCodePath}'" C-m

echo "[launcher] Started ${windowName} window"
`;

  // Build setup command
  const setupCommand = `
set -eu
mkdir -p '${runtimeDir}'

# Write the main script
cat > '${scriptFilePath}' <<'SCRIPT_EOF'
${wrappedScript}
SCRIPT_EOF
chmod +x '${scriptFilePath}'

# Write the launcher script
cat > '${launcherScriptPath}' <<'LAUNCHER_EOF'
${launcherScript}
LAUNCHER_EOF
chmod +x '${launcherScriptPath}'

# Run the launcher in background
nohup zsh '${launcherScriptPath}' > '${runtimeDir}/${windowName}-launcher.log' 2>&1 &
LAUNCHER_PID=$!

# Give it a moment to start
sleep 1

# Verify it started
if kill -0 $LAUNCHER_PID 2>/dev/null; then
  echo "[setup] Launcher started (PID: $LAUNCHER_PID)"
else
  echo "[setup] Launcher may have completed or failed, check log" >&2
fi
`;

  const response = await execFn(setupCommand);

  if (response.error || response.exit_code !== 0) {
    console.warn("[preview-jobs] Failed to start tmux window", {
      previewRunId,
      windowName,
      exitCode: response.exit_code,
      stdout: sliceOutput(response.stdout),
      stderr: sliceOutput(response.stderr),
      error: response.error,
    });
  } else {
    console.log("[preview-jobs] Started tmux window", {
      previewRunId,
      windowName,
    });
  }
}

async function ensureTmuxSession({
  morphClient,
  instanceId,
  repoDir,
  previewRunId,
}: {
  morphClient: ReturnType<typeof createMorphCloudClient>;
  instanceId: string;
  repoDir: string;
  previewRunId: Id<"previewRuns">;
}): Promise<void> {
  // Match the orchestrator: create session with -n main for the initial window
  const sessionCmd = [
    "zsh",
    "-lc",
    `tmux has-session -t cmux 2>/dev/null || tmux new-session -d -s cmux -c ${singleQuote(repoDir)} -n main`,
  ];
  const response = await execInstanceInstanceIdExecPost({
    client: morphClient,
    path: { instance_id: instanceId },
    body: { command: sessionCmd },
  });
  if (response.error || response.data?.exit_code !== 0) {
    console.warn("[preview-jobs] Failed to ensure tmux session", {
      previewRunId,
      exitCode: response.data?.exit_code,
      stdout: sliceOutput(response.data?.stdout),
      stderr: sliceOutput(response.data?.stderr),
      error: response.error,
    });
  }
}

// Constants matching the environment orchestrator script
const MAINTENANCE_WINDOW_NAME = "maintenance";
const DEV_WINDOW_NAME = "dev";

async function runScriptInTmuxWindow({
  morphClient,
  instanceId,
  repoDir,
  windowName,
  scriptContent,
  previewRunId,
  useSetE = true,
}: {
  morphClient: ReturnType<typeof createMorphCloudClient>;
  instanceId: string;
  repoDir: string;
  windowName: string;
  scriptContent: string;
  previewRunId: Id<"previewRuns">;
  useSetE?: boolean;
}): Promise<void> {
  const trimmed = scriptContent.trim();
  if (!trimmed) {
    return;
  }

  // Create script wrapper matching the environment orchestrator format
  // Source /etc/profile to get system environment variables like RUSTUP_HOME
  const setFlags = useSetE ? "set -eux" : "set -ux";
  const wrappedScript = `#!/bin/zsh
${setFlags}

# Source system profile for environment variables (RUSTUP_HOME, etc.)
[[ -f /etc/profile ]] && source /etc/profile

cd ${repoDir}

echo "=== ${windowName} Script Started at $(date) ==="
${trimmed}
${useSetE ? `echo "=== ${windowName} Script Completed at $(date) ==="` : ""}
`;

  const runtimeDir = "/var/tmp/cmux-scripts";
  const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const scriptFilePath = `${runtimeDir}/${windowName}.sh`;
  const launcherScriptPath = `${runtimeDir}/${windowName}-launcher.sh`;
  const logFilePath = `${runtimeDir}/${windowName}_${runId}.log`;
  const exitCodePath = `${runtimeDir}/${windowName}_${runId}.exit-code`;

  // Create a launcher script that runs INSIDE the VM to handle tmux operations
  // This matches how the environment orchestrator works - it runs tmux commands
  // from within a shell process inside the VM, not via exec API
  const launcherScript = `#!/bin/zsh
set -eu

# Create the tmux window
tmux new-window -t cmux: -n '${windowName}' -d

# Send keys to run the script (matching orchestrator pattern exactly)
# Pattern: zsh 'script.sh' 2>&1 | tee 'log'; echo \${pipestatus[1]} > 'exit-code'
tmux send-keys -t cmux:'${windowName}' "zsh '${scriptFilePath}' 2>&1 | tee '${logFilePath}'; echo \\\${pipestatus[1]} > '${exitCodePath}'" C-m

echo "[launcher] Started ${windowName} window"
`;

  // Build a setup command that writes both scripts and runs the launcher in background
  // The key insight: Morph exec API doesn't have a TTY, but a background process can
  // interact with tmux properly. This matches the sandbox orchestrator pattern.
  const setupCommand = `
set -eu
mkdir -p '${runtimeDir}'

# Write the main script
cat > '${scriptFilePath}' <<'SCRIPT_EOF'
${wrappedScript}
SCRIPT_EOF
chmod +x '${scriptFilePath}'

# Write the launcher script
cat > '${launcherScriptPath}' <<'LAUNCHER_EOF'
${launcherScript}
LAUNCHER_EOF
chmod +x '${launcherScriptPath}'

# Run the launcher in background (like sandbox orchestrator does with nohup)
nohup zsh '${launcherScriptPath}' > '${runtimeDir}/${windowName}-launcher.log' 2>&1 &
LAUNCHER_PID=$!

# Give it a moment to start
sleep 1

# Verify it started
if kill -0 $LAUNCHER_PID 2>/dev/null; then
  echo "[setup] Launcher started (PID: $LAUNCHER_PID)"
else
  echo "[setup] Launcher may have completed or failed, check log" >&2
fi
`;

  const response = await execInstanceInstanceIdExecPost({
    client: morphClient,
    path: { instance_id: instanceId },
    body: { command: ["zsh", "-lc", setupCommand] },
  });

  if (response.error || response.data?.exit_code !== 0) {
    console.warn("[preview-jobs] Failed to start tmux window", {
      previewRunId,
      windowName,
      exitCode: response.data?.exit_code,
      stdout: sliceOutput(response.data?.stdout),
      stderr: sliceOutput(response.data?.stderr),
      error: response.error,
    });
  } else {
    console.log("[preview-jobs] Started tmux window", {
      previewRunId,
      windowName,
    });
  }
}

/**
 * Helper to mark task run and parent task as completed when skipping preview execution.
 * Consolidates the repeated pattern of completing both taskRun and its parent task.
 */
async function markTaskRunAsSkipped(
  ctx: ActionCtx,
  taskRunId: Id<"taskRuns">,
  previewRunId: Id<"previewRuns">,
  skipReason: string,
): Promise<void> {
  try {
    await ctx.runMutation(internal.taskRuns.workerComplete, {
      taskRunId,
      exitCode: 0,
    });
    console.log("[preview-jobs] Task run marked as completed", {
      previewRunId,
      taskRunId,
      skipReason,
    });
    // Also mark the parent task as completed
    const taskRun = await ctx.runQuery(internal.taskRuns.getById, { id: taskRunId });
    if (taskRun?.taskId) {
      await ctx.runMutation(internal.tasks.setCompletedInternal, {
        taskId: taskRun.taskId,
        isCompleted: true,
        crownEvaluationStatus: "succeeded",
      });
      console.log("[preview-jobs] Task marked as completed", {
        previewRunId,
        taskId: taskRun.taskId,
        skipReason,
      });
    }
  } catch (completeError) {
    console.error("[preview-jobs] Failed to mark task run/task as completed", {
      previewRunId,
      taskRunId,
      skipReason,
      error: completeError instanceof Error ? completeError.message : String(completeError),
    });
  }
}

export async function runPreviewJob(
  ctx: ActionCtx,
  previewRunId: Id<"previewRuns">,
) {
  const morphApiKey = env.MORPH_API_KEY;
  if (!morphApiKey) {
    console.warn("[preview-jobs] MORPH_API_KEY not configured; skipping run", {
      previewRunId,
    });
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "failed",
    });
    return;
  }

  const morphClient = createMorphCloudClient({
    auth: morphApiKey,
  });

  const payload = await ctx.runQuery(internal.previewRuns.getRunWithConfig, {
    previewRunId,
  });
  if (!payload?.run || !payload.config) {
    console.warn("[preview-jobs] Missing run/config for dispatch", {
      previewRunId,
    });
    return;
  }

  // Note: We continue even if status is "superseded" because each preview run
  // should complete and update its own GitHub comment. The user pushed this commit
  // and deserves to see its preview results.

  const convexUrl = resolveConvexUrl();
  if (!convexUrl) {
    console.error("[preview-jobs] Convex URL not configured; cannot trigger screenshots", {
      previewRunId,
    });
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "failed",
    });
    return;
  }

  const { run, config } = payload;
  let taskRunId: Id<"taskRuns"> | null = run.taskRunId ?? null;

  if (!config.environmentId) {
    console.warn("[preview-jobs] Preview config missing environmentId; skipping run", {
      previewRunId,
      repoFullName: run.repoFullName,
      prNumber: run.prNumber,
    });
    if (taskRunId) {
      await markTaskRunAsSkipped(ctx, taskRunId, previewRunId, "no environmentId");
    }
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "completed",
    });
    return;
  }

  const environment = await ctx.runQuery(internal.environments.getByIdInternal, {
    id: config.environmentId,
  });

  if (!environment) {
    console.warn("[preview-jobs] Environment not found for preview run; skipping", {
      previewRunId,
      environmentId: config.environmentId,
    });
    if (taskRunId) {
      await markTaskRunAsSkipped(ctx, taskRunId, previewRunId, "environment not found");
    }
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "completed",
    });
    return;
  }

  const snapshotId = environment.snapshotId;
  const snapshotProvider = environment.snapshotProvider ?? "other";

  if (!snapshotId) {
    console.warn("[preview-jobs] Environment missing snapshot; skipping", {
      previewRunId,
      environmentId: environment._id,
    });
    if (taskRunId) {
      await markTaskRunAsSkipped(ctx, taskRunId, previewRunId, "no snapshot");
    }
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "completed",
    });
    return;
  }

  // Validate snapshot provider - now supports morph and pve-lxc
  if (snapshotProvider !== "morph" && snapshotProvider !== "pve-lxc") {
    console.warn("[preview-jobs] Unsupported snapshot provider", {
      previewRunId,
      environmentId: environment._id,
      snapshotProvider,
    });
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "completed",
    });
    return;
  }

  // Track instance info with unified interface
  let unifiedInstance: UnifiedInstance | null = null;
  let morphInstance: InstanceModel | null = null; // Keep for Morph-specific operations
  let taskId: Id<"tasks"> | null = null;
  let wasSuperseded = false; // Track if the run was superseded for cleanup
  let keepInstanceForTaskRun = false;
  let execFn: ExecFn | null = null;
  let stopFn: StopFn | null = null;
  let readFileFn: ReadFileFn | null = null;

  // Note: task/taskRun creation is now deferred until AFTER the VM starts
  // This ensures the preview job doesn't appear in the UI until it has working links

  // If we already have a taskRunId (from non-test runs), get the taskId
  if (taskRunId) {
    const existingTaskRun = await ctx.runQuery(internal.taskRuns.getById, { id: taskRunId });
    if (existingTaskRun?.taskId) {
      taskId = existingTaskRun.taskId;
    } else {
      console.error("[preview-jobs] Task run missing taskId", {
        previewRunId,
        taskRunId,
        hasTaskRun: Boolean(existingTaskRun),
      });
    }
  }

  console.log("[preview-jobs] Launching sandbox instance", {
    previewRunId,
    snapshotProvider,
    snapshotId,
    templateVmid: environment.templateVmid,
    repoFullName: run.repoFullName,
    prNumber: run.prNumber,
    headSha: run.headSha,
    baseSha: run.baseSha,
  });

  await ctx.runMutation(internal.previewRuns.updateStatus, {
    previewRunId,
    status: "running",
  });

  // Post initial GitHub comment early with diff heatmap link
  // This gives users immediate feedback while screenshots are being captured
  // Skip for test preview runs (stateReason === "Test preview run") - they shouldn't post to GitHub
  const isTestRun = run.stateReason === "Test preview run";
  if (run.repoInstallationId && !isTestRun) {
    try {
      const initialCommentResult = await ctx.runAction(
        internal.github_pr_comments.postInitialPreviewComment,
        {
          installationId: run.repoInstallationId,
          repoFullName: run.repoFullName,
          prNumber: run.prNumber,
          previewRunId,
        },
      );

      if (initialCommentResult.ok) {
        console.log("[preview-jobs] Posted initial GitHub comment", {
          previewRunId,
          commentId: initialCommentResult.commentId,
        });
      } else {
        console.warn("[preview-jobs] Failed to post initial GitHub comment", {
          previewRunId,
          error: initialCommentResult.error,
        });
      }
    } catch (error) {
      // Log but don't fail the preview job if initial comment fails
      console.warn("[preview-jobs] Error posting initial GitHub comment", {
        previewRunId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    console.log("[preview-jobs] Starting sandbox instance", {
      previewRunId,
      snapshotProvider,
      hasTaskRunId: Boolean(taskRunId),
      snapshotId,
    });

    // Start VM/container based on provider - task/taskRun creation happens AFTER ready
    const instanceMetadata = {
      app: "cmux-preview",
      previewRunId: previewRunId,
      repo: run.repoFullName,
      prNumber: String(run.prNumber),
      headSha: run.headSha,
    };

    if (snapshotProvider === "morph") {
      // Start Morph instance
      morphInstance = await startMorphInstance(morphClient, {
        snapshotId,
        metadata: instanceMetadata,
        ttlSeconds: 3600,
        ttlAction: "stop",
        readinessTimeoutMs: 5 * 60 * 1000,
      });
      unifiedInstance = toUnifiedInstance(morphInstance);
      execFn = createMorphExecFn(morphClient, morphInstance.id);
      stopFn = () => stopMorphInstance(morphClient, morphInstance!.id);
      readFileFn = async (filePath: string) => {
        return await readFileFromMorph({
          morphClient,
          instanceId: morphInstance!.id,
          filePath,
        });
      };
    } else if (snapshotProvider === "pve-lxc") {
      // Start PVE-LXC instance via www proxy
      const pveLxcInstance = await startPveLxcInstance({
        snapshotId,
        templateVmid: environment.templateVmid,
        metadata: instanceMetadata,
        ttlSeconds: 3600,
        ttlAction: "stop",
        readinessTimeoutMs: 5 * 60 * 1000,
      });
      unifiedInstance = pveLxcToUnifiedInstance(pveLxcInstance);
      execFn = createPveLxcExecFn(pveLxcInstance.instanceId);
      stopFn = () => stopPveLxcInstance(pveLxcInstance.instanceId);
      readFileFn = async (filePath: string) => {
        return await readFileFromPveLxc({
          instanceId: pveLxcInstance.instanceId,
          filePath,
        });
      };
    } else {
      throw new Error(`Unsupported snapshot provider: ${snapshotProvider}`);
    }

    // Get service URLs from unified instance
    const getServiceUrl = (port: number) =>
      unifiedInstance?.httpServices.find((s) => s.port === port)?.url;

    const workerServiceUrl = getServiceUrl(39377);
    if (!workerServiceUrl) {
      throw new Error("Worker service not found on instance");
    }

    const vscodeServiceUrl = getServiceUrl(39378);
    const vscodeUrl = vscodeServiceUrl
      ? `${vscodeServiceUrl}?folder=/root/workspace`
      : null;

    console.log("[preview-jobs] Worker service ready", {
      previewRunId,
      instanceId: unifiedInstance.id,
      provider: unifiedInstance.provider,
      vscodeUrl,
      workerUrl: workerServiceUrl,
      workerHealthUrl: `${workerServiceUrl}/health`,
    });

    // Note: We intentionally do NOT abort on supersession here.
    // Each preview run should complete and update its own GitHub comment,
    // even if a newer commit has arrived. This ensures the user sees results
    // for each commit they pushed.

    // Now that VM is running, create task/taskRun if needed
    // This ensures the preview job only appears in UI after VM has working links
    if (!taskRunId) {
      console.log("[preview-jobs] VM ready, now creating task/taskRun", {
        previewRunId,
        repoFullName: run.repoFullName,
        prNumber: run.prNumber,
      });

      // Use "system" as fallback for legacy configs without createdByUserId
      const configUserId = config.createdByUserId ?? "system";

      taskId = await ctx.runMutation(internal.tasks.createForPreview, {
        teamId: run.teamId,
        userId: configUserId,
        previewRunId,
        repoFullName: run.repoFullName,
        prNumber: run.prNumber,
        prUrl: run.prUrl,
        headSha: run.headSha,
        baseBranch: config.repoDefaultBranch,
      });

      const { taskRunId: createdTaskRunId } = await ctx.runMutation(
        internal.taskRuns.createForPreview,
        {
          taskId,
          teamId: run.teamId,
          userId: configUserId,
          prUrl: run.prUrl,
          environmentId: config.environmentId,
          newBranch: run.headRef,
        },
      );

      await ctx.runMutation(internal.previewRuns.linkTaskRun, {
        previewRunId,
        taskRunId: createdTaskRunId,
      });

      taskRunId = createdTaskRunId;

      console.log("[preview-jobs] Created and linked task/taskRun for preview run", {
        previewRunId,
        taskId,
        taskRunId,
      });
    }

    // Keep instance running if we have a taskRun (for interactive access)
    keepInstanceForTaskRun = Boolean(taskRunId);

    // Generate JWT for screenshot upload authentication now that we have taskRunId
    const previewJwt = taskRunId
      ? await new SignJWT({
        taskRunId,
        teamId: run.teamId,
        userId: config.createdByUserId,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("12h")
        .sign(new TextEncoder().encode(env.CMUX_TASK_RUN_JWT_SECRET))
      : null;

    // Update taskRun with VM instance info and URLs
    if (taskRunId && unifiedInstance) {
      const networking = unifiedInstance.httpServices.map((s) => ({
        status: "running" as const,
        port: s.port,
        url: s.url,
      }));

      await ctx.runMutation(internal.taskRuns.updateVSCodeMetadataInternal, {
        taskRunId,
        vscode: {
          provider: unifiedInstance.provider,
          status: "running",
          containerName: unifiedInstance.id,
          url: vscodeUrl ?? undefined,
          workspaceUrl: vscodeUrl ?? undefined,
          startedAt: Date.now(),
          ports: {
            vscode: getServiceUrl(39378) ?? "",
            worker: getServiceUrl(39377) ?? "",
            vnc: getServiceUrl(39375),
          },
        },
        networking,
      });
      console.log("[preview-jobs] Updated task run metadata with instance info", {
        taskRunId,
        instanceId: unifiedInstance.id,
        provider: unifiedInstance.provider,
      });
    }

    // Step 2: Fetch latest changes and checkout PR
    // Preview environment snapshots have the repo pre-cloned at /root/workspace
    const repoSearchRoot = "/root/workspace";

    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "running",
    });

    // The repository is always at /root/workspace directly
    const repoDir = repoSearchRoot;

    console.log("[preview-jobs] Using pre-cloned repository", {
      previewRunId,
      repoFullName: run.repoFullName,
      repoDir,
    });

    console.log("[preview-jobs] Starting GitHub authentication setup", {
      previewRunId,
      hasInstallationId: Boolean(run.repoInstallationId),
      installationId: run.repoInstallationId,
    });

    // Get GitHub App installation token for fetching from private repos
    if (run.repoInstallationId) {
      console.log("[preview-jobs] Fetching installation access token", {
        previewRunId,
        installationId: run.repoInstallationId,
      });

      let accessToken: string | null = null;
      try {
        accessToken = await fetchInstallationAccessToken(run.repoInstallationId);
      } catch (error) {
        console.error("[preview-jobs] Failed to fetch installation token", {
          previewRunId,
          installationId: run.repoInstallationId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      console.log("[preview-jobs] Installation token fetch result", {
        previewRunId,
        hasToken: Boolean(accessToken),
      });

      if (accessToken) {
        const escapedToken = singleQuote(accessToken);

        let lastError: Error | undefined;
        let authSucceeded = false;
        const maxRetries = 5;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const shellScript = `cd ${repoDir} && printf %s ${escapedToken} | gh auth login --with-token && gh auth setup-git 2>&1`;

            const ghAuthResponse = await execFn!(shellScript);

            console.log("[preview-jobs] GitHub auth response received", {
              previewRunId,
              attempt,
              hasError: Boolean(ghAuthResponse.error),
              exitCode: ghAuthResponse.exit_code,
              stdout: sliceOutput(ghAuthResponse.stdout, 500),
              stderr: sliceOutput(ghAuthResponse.stderr, 500),
            });

            if (ghAuthResponse.error) {
              lastError = new Error(`API error: ${JSON.stringify(ghAuthResponse.error)}`);
              console.error("[preview-jobs] GitHub auth API error", {
                previewRunId,
                attempt,
                error: ghAuthResponse.error,
              });
            } else if (ghAuthResponse.exit_code === 0) {
              console.log("[preview-jobs] GitHub authentication configured successfully", {
                previewRunId,
                attempt,
                stdout: sliceOutput(ghAuthResponse.stdout, 500),
                stderr: sliceOutput(ghAuthResponse.stderr, 500),
              });
              authSucceeded = true;
              break;
            } else {
              const errorMessage = ghAuthResponse.stderr || ghAuthResponse.stdout || "Unknown error";
              lastError = new Error(`GitHub auth failed: ${errorMessage.slice(0, 500)}`);
              console.warn("[preview-jobs] GitHub auth command failed", {
                previewRunId,
                attempt,
                exitCode: ghAuthResponse.exit_code,
                stderr: sliceOutput(ghAuthResponse.stderr, 200),
                stdout: sliceOutput(ghAuthResponse.stdout, 200),
              });
            }

            if (attempt < maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
              console.log("[preview-jobs] Retrying GitHub auth", {
                previewRunId,
                attempt,
                delayMs: delay,
              });
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            lastError = normalizedError;
            console.error("[preview-jobs] GitHub auth attempt threw error", {
              previewRunId,
              attempt,
              error: normalizedError.message,
            });

            if (attempt < maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }

        if (!authSucceeded) {
          console.error("[preview-jobs] GitHub authentication failed after all retries", {
            previewRunId,
            maxRetries,
            lastError: lastError?.message,
          });
          const finalErrorMessage = lastError?.message || "Unknown error";
          throw new Error(
            `GitHub authentication failed after ${maxRetries} attempts: ${finalErrorMessage}`
          );
        }
      } else {
        console.warn("[preview-jobs] Failed to fetch installation token, falling back to public fetch", {
          previewRunId,
          installationId: run.repoInstallationId,
        });
      }
    } else {
      console.log("[preview-jobs] No installation ID, skipping GitHub authentication", {
        previewRunId,
      });
    }

    console.log("[preview-jobs] Starting git fetch from origin", {
      previewRunId,
      repoDir,
    });

    // Fetch the latest changes from origin (fetch all refs)
    const fetchResponse = await execFn!(["git", "-C", repoDir, "fetch", "origin"]);

    if (fetchResponse.error || fetchResponse.exit_code !== 0) {
      console.error("[preview-jobs] Fetch failed", {
        previewRunId,
        exitCode: fetchResponse.exit_code,
        stdout: fetchResponse.stdout,
        stderr: fetchResponse.stderr,
      });
      throw new Error(
        `Failed to fetch from origin (exit ${fetchResponse.exit_code}): ${fetchResponse.stderr || fetchResponse.stdout}`
      );
    }

    console.log("[preview-jobs] Fetched latest changes from origin", {
      previewRunId,
      headSha: run.headSha,
    });

    // Update local default branch ref to match origin
    // This ensures tools like Claude that run `git diff main..branch` use fresh refs
    // Unlike `git pull`, this updates the ref without requiring checkout or modifying working directory
    const defaultBranch = config.repoDefaultBranch || "main";
    const updateDefaultBranchResponse = await execFn!(["git", "-C", repoDir, "fetch", "origin", `${defaultBranch}:${defaultBranch}`]);

    if (updateDefaultBranchResponse.error || updateDefaultBranchResponse.exit_code !== 0) {
      // Non-fatal: log warning but continue - the origin/main ref is still available
      console.warn("[preview-jobs] Failed to update local default branch ref", {
        previewRunId,
        defaultBranch,
        exitCode: updateDefaultBranchResponse.exit_code,
        stderr: sliceOutput(updateDefaultBranchResponse.stderr),
      });
    } else {
      console.log("[preview-jobs] Updated local default branch ref", {
        previewRunId,
        defaultBranch,
      });
    }

    // Stash any local changes and pull latest from origin before checkout
    // This ensures the working directory is clean and up-to-date with origin
    await stashLocalChangesWithExecFn({
      execFn: execFn!,
      repoDir,
      previewRunId,
      headSha: run.headSha,
    });

    // Pull latest changes from origin for the current branch
    // Use --rebase to avoid merge commits in case there are any unstashed changes
    console.log("[preview-jobs] Pulling latest from origin", {
      previewRunId,
      repoDir,
    });

    const pullResponse = await execFn!(["git", "-C", repoDir, "pull", "--rebase", "origin"]);

    if (pullResponse.error || pullResponse.exit_code !== 0) {
      // Non-fatal: log warning but continue - we may be in detached HEAD state
      // or the current branch may not track a remote
      console.warn("[preview-jobs] Failed to pull from origin (may be expected)", {
        previewRunId,
        exitCode: pullResponse.exit_code,
        stderr: sliceOutput(pullResponse.stderr),
        stdout: sliceOutput(pullResponse.stdout),
      });
    } else {
      console.log("[preview-jobs] Pulled latest from origin", {
        previewRunId,
        stdout: sliceOutput(pullResponse.stdout),
      });
    }

    await ensureCommitAvailableWithExecFn({
      execFn: execFn!,
      repoDir,
      commitSha: run.headSha,
      prNumber: run.prNumber,
      previewRunId,
      headRepoCloneUrl: run.headRepoCloneUrl,
      headRef: run.headRef,
    });

    console.log("[preview-jobs] Starting git checkout", {
      previewRunId,
      headSha: run.headSha,
      repoDir,
    });

    // Step 3: Checkout the PR commit
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "running",
    });

    // Use -f (force) to discard any local modifications that would conflict
    // This is safe because we already stashed changes above
    const checkoutCmd = run.headRef
      ? ["git", "-C", repoDir, "checkout", "-f", "-B", run.headRef, run.headSha]
      : ["git", "-C", repoDir, "checkout", "-f", run.headSha];

    const checkoutResponse = await execFn!(checkoutCmd);

    if (checkoutResponse.error) {
      throw new Error(
        `Failed to checkout PR branch ${run.headSha}: ${JSON.stringify(checkoutResponse.error)}`,
      );
    }

    if (checkoutResponse.exit_code !== 0) {
      console.error("[preview-jobs] Checkout failed - full output", {
        previewRunId,
        headSha: run.headSha,
        exitCode: checkoutResponse.exit_code,
        stdout: checkoutResponse.stdout,
        stderr: checkoutResponse.stderr,
      });
      throw new Error(
        `Failed to checkout PR branch ${run.headSha} (exit ${checkoutResponse.exit_code}): stderr="${checkoutResponse.stderr}" stdout="${checkoutResponse.stdout}"`,
      );
    }

    console.log("[preview-jobs] Checked out PR branch", {
      previewRunId,
      headSha: run.headSha,
      stdout: checkoutResponse.stdout?.slice(0, 200),
    });


    // Step 4: Apply environment variables and trigger screenshot collection
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "running",
    });

    if (taskRunId && previewJwt) {
      // Apply environment variables via envctl (same as crown runs)
      // CMUX_IS_STAGING=false tells the screenshot collector to use production releases
      // We always use production releases to avoid missing release issues in dev
      const envLines = [
        `CMUX_TASK_RUN_ID="${taskRunId}"`,
        `CMUX_TASK_RUN_JWT="${previewJwt}"`,
        `CONVEX_SITE_URL="${convexUrl}"`,
        `CONVEX_URL="${convexUrl}"`,
        `CMUX_IS_STAGING="false"`,
      ];
      const envVarsContent = envLines.join("\n");
      if (envVarsContent.length === 0) {
        console.error("[preview-jobs] Empty environment payload before envctl", {
          previewRunId,
          taskRunId,
        });
        throw new Error("Cannot apply empty environment payload via envctl");
      }
      const envBase64 = stringToBase64(envVarsContent);
      console.log("[preview-jobs] Applying environment variables via envctl", {
        previewRunId,
        taskRunId,
        payloadLength: envVarsContent.length,
      });
      // Call envctl with explicit base64 argument to avoid shell quoting issues
      const envctlResponse = await execFn!(["envctl", "load", "--base64", envBase64]);

      if (envctlResponse.error || envctlResponse.exit_code !== 0) {
        console.error("[preview-jobs] Failed to apply environment variables", {
          previewRunId,
          exitCode: envctlResponse.exit_code,
          stderr: sliceOutput(envctlResponse.stderr),
          stdout: sliceOutput(envctlResponse.stdout),
          error: envctlResponse.error,
        });
        throw new Error("Failed to apply environment variables via envctl");
      }

      console.log("[preview-jobs] Applied environment variables via envctl", {
        previewRunId,
        taskRunId,
        convexUrl,
        cmuxIsStaging: "false",
        envctlStdout: sliceOutput(envctlResponse.stdout),
        envctlStderr: sliceOutput(envctlResponse.stderr),
      });

      // Start tmux session and run maintenance/dev scripts if provided
      // Note: tmux operations currently use Morph-specific functions
      // For PVE-LXC, we use equivalent provider-agnostic implementations
      if (snapshotProvider === "morph" && morphInstance) {
        await ensureTmuxSession({
          morphClient,
          instanceId: morphInstance.id,
          repoDir,
          previewRunId,
        });

        if (environment.maintenanceScript) {
          await runScriptInTmuxWindow({
            morphClient,
            instanceId: morphInstance.id,
            repoDir,
            windowName: MAINTENANCE_WINDOW_NAME,
            scriptContent: environment.maintenanceScript,
            previewRunId,
            useSetE: true,
          });
        }

        if (environment.devScript) {
          await runScriptInTmuxWindow({
            morphClient,
            instanceId: morphInstance.id,
            repoDir,
            windowName: DEV_WINDOW_NAME,
            scriptContent: environment.devScript,
            previewRunId,
            useSetE: false, // Dev script runs indefinitely, don't exit on error
          });
        }
      } else if (snapshotProvider === "pve-lxc") {
        // For PVE-LXC, run tmux and script setup via execFn
        await ensureTmuxSessionWithExecFn({
          execFn: execFn!,
          repoDir,
          previewRunId,
        });

        if (environment.maintenanceScript) {
          await runScriptInTmuxWindowWithExecFn({
            execFn: execFn!,
            repoDir,
            windowName: MAINTENANCE_WINDOW_NAME,
            scriptContent: environment.maintenanceScript,
            previewRunId,
            useSetE: true,
          });
        }

        if (environment.devScript) {
          await runScriptInTmuxWindowWithExecFn({
            execFn: execFn!,
            repoDir,
            windowName: DEV_WINDOW_NAME,
            scriptContent: environment.devScript,
            previewRunId,
            useSetE: false,
          });
        }
      }

      // Verify task run exists before triggering screenshots
      console.log("[preview-jobs] Verifying task run is queryable", {
        previewRunId,
        taskRunId,
      });

      let taskRunVerified = false;
      for (let attempt = 1; attempt <= 5; attempt++) {
        const verifyTaskRun = await ctx.runQuery(internal.taskRuns.getById, {
          id: taskRunId,
        });

        if (verifyTaskRun) {
          console.log("[preview-jobs] Task run verified", {
            previewRunId,
            taskRunId,
            attempt,
          });
          taskRunVerified = true;
          break;
        }

        console.warn("[preview-jobs] Task run not yet queryable, retrying", {
          previewRunId,
          taskRunId,
          attempt,
        });

        if (attempt < 5) {
          await delay(1000); // Wait 1 second between attempts
        }
      }

      if (!taskRunVerified) {
        throw new Error(`Task run ${taskRunId} not queryable after verification attempts`);
      }

      const screenshotWorkflowEnabled =
        env.CMUX_ENABLE_SCREENSHOT_WORKFLOW === "true" ||
        env.CMUX_ENABLE_SCREENSHOT_WORKFLOW === "1";

      if (!screenshotWorkflowEnabled) {
        console.log(
          "[preview-jobs] Screenshot workflow disabled (CMUX_ENABLE_SCREENSHOT_WORKFLOW not set to true/1)",
          { previewRunId },
        );

        try {
          await ctx.runMutation(internal.previewScreenshots.createScreenshotSet, {
            previewRunId,
            status: "skipped",
            commitSha: run.headSha,
            error: "Screenshot workflow disabled (CMUX_ENABLE_SCREENSHOT_WORKFLOW not set to true/1)",
            images: [],
            videos: [],
          });

          console.log("[preview-jobs] Screenshot set marked as skipped", {
            previewRunId,
          });

          // Trigger GitHub comment update (skip for test runs)
          if (!isTestRun) {
            await ctx.runAction(internal.previewScreenshots.triggerGithubComment, {
              previewRunId,
            });

            console.log("[preview-jobs] GitHub comment update triggered", {
              previewRunId,
            });
          } else {
            console.log("[preview-jobs] Skipping GitHub comment for test run", {
              previewRunId,
            });
          }
        } catch (screenshotSetError) {
          console.error("[preview-jobs] Failed to create skipped screenshot set", {
            previewRunId,
            error:
              screenshotSetError instanceof Error
                ? screenshotSetError.message
                : String(screenshotSetError),
          });
        }
      } else {
        // Trigger screenshot collection via Morph exec (bypasses worker)
        // Always use production releases (staging=false) to avoid missing release issues
        // Both staging and production Convex deployments will fetch from the same release pool
        const isStaging = false;

        // Fetch the screenshot collector release URL
        const collectorRelease = await fetchScreenshotCollectorRelease({
          convexUrl,
          isStaging,
          previewRunId,
        });

        // Get changed files via exec
        // Pass baseSha from the PR webhook for more reliable diffing (especially for repos
        // where origin/main might not exist, e.g., forks or repos with different default branches)
        const changedFiles = await getChangedFilesWithExecFn({
          execFn: execFn!,
          repoDir,
          baseBranch: defaultBranch,
          baseSha: run.baseSha,
          previewRunId,
        });

        if (changedFiles.length === 0) {
          console.log("[preview-jobs] No changed files detected, skipping screenshot collection", {
            previewRunId,
          });
        } else {
          // Build screenshot collector options
          const setupScript = [
            environment.maintenanceScript?.trim(),
            environment.devScript?.trim(),
          ]
            .filter((value): value is string => Boolean(value))
            .join("\n\n");
          const screenshotOptions: ScreenshotCollectorOptions = {
            workspaceDir: repoDir,
            changedFiles,
            prTitle: run.prTitle || `PR #${run.prNumber}`,
            prDescription: run.prDescription || "",
            baseBranch: defaultBranch,
            headBranch: run.headRef || run.headSha,
            outputDir: `/root/screenshots/${Date.now()}-pr-${run.prNumber}`,
            pathToClaudeCodeExecutable: "/root/.bun/bin/claude",
            setupScript: setupScript.length > 0 ? setupScript : undefined,
            installCommand: environment.maintenanceScript ?? undefined,
            devCommand: environment.devScript ?? undefined,
            convexSiteUrl: convexUrl,
            auth: { taskRunJwt: previewJwt },
          };

          // Run the screenshot collector
          // For Morph: use the Morph-specific runScreenshotCollector
          // For PVE-LXC: use provider-agnostic version
          let collectorResult: ScreenshotCollectorResult;
          if (snapshotProvider === "morph" && morphInstance) {
            collectorResult = await runScreenshotCollector({
              ctx,
              morphClient,
              instanceId: morphInstance.id,
              collectorUrl: collectorRelease.url,
              options: screenshotOptions,
              previewRunId,
            });
          } else {
            // For PVE-LXC, use provider-agnostic screenshot collection
            collectorResult = await runScreenshotCollectorWithExecFn({
              execFn: execFn!,
              collectorUrl: collectorRelease.url,
              options: screenshotOptions,
              previewRunId,
            });
          }

          console.log("[preview-jobs] Screenshot collector result", {
            previewRunId,
            status: collectorResult.status,
            screenshotCount: collectorResult.screenshots?.length ?? 0,
            videoCount: collectorResult.videos?.length ?? 0,
            hasUiChanges: collectorResult.hasUiChanges,
            error: collectorResult.error,
          });

          // Upload screenshots to Convex storage and create screenshot set
          const uploadedImages: Array<{
            storageId: Id<"_storage">;
            mimeType: string;
            fileName?: string;
            commitSha?: string;
            description?: string;
          }> = [];

          const uploadedVideos: Array<{
            storageId: Id<"_storage">;
            mimeType: string;
            fileName?: string;
            description?: string;
          }> = [];

          if (collectorResult.status === "completed" && collectorResult.screenshots && collectorResult.screenshots.length > 0) {
            console.log("[preview-jobs] Uploading screenshots to Convex storage", {
              previewRunId,
              screenshotCount: collectorResult.screenshots.length,
            });

            for (const screenshot of collectorResult.screenshots) {
              try {
                // Read the screenshot file from VM using provider-agnostic readFileFn
                const fileData = await readFileFn!(screenshot.path);

                if (!fileData) {
                  console.warn("[preview-jobs] Failed to read screenshot file", {
                    previewRunId,
                    path: screenshot.path,
                  });
                  continue;
                }

                // Convert base64 to binary and upload to Convex storage
                const binaryData = Uint8Array.from(atob(fileData.base64), (c) => c.charCodeAt(0));
                const mimeType = getMimeTypeFromPath(screenshot.path);
                const blob = new Blob([binaryData], { type: mimeType });
                const storageId = await ctx.storage.store(blob);

                // Extract filename from path
                const fileName = screenshot.path.split("/").pop() || "screenshot.png";

                uploadedImages.push({
                  storageId,
                  mimeType,
                  fileName,
                  commitSha: run.headSha,
                  description: screenshot.description,
                });

                console.log("[preview-jobs] Uploaded screenshot", {
                  previewRunId,
                  path: screenshot.path,
                  storageId,
                  size: fileData.size,
                });
              } catch (uploadError) {
                console.error("[preview-jobs] Failed to upload screenshot", {
                  previewRunId,
                  path: screenshot.path,
                  error: uploadError instanceof Error ? uploadError.message : String(uploadError),
                });
              }
            }
          }

          // Upload videos to Convex storage
          if (collectorResult.status === "completed" && collectorResult.videos && collectorResult.videos.length > 0) {
            console.log("[preview-jobs] Uploading videos to Convex storage", {
              previewRunId,
              videoCount: collectorResult.videos.length,
            });

            for (const video of collectorResult.videos) {
              try {
                // Read the video file from VM using provider-agnostic readFileFn
                const fileData = await readFileFn!(video.path);

                if (!fileData) {
                  console.warn("[preview-jobs] Failed to read video file", {
                    previewRunId,
                    path: video.path,
                  });
                  continue;
                }

                // Convert base64 to binary and upload to Convex storage
                const binaryData = Uint8Array.from(atob(fileData.base64), (c) => c.charCodeAt(0));
                const mimeType = getMimeTypeFromPath(video.path);
                const blob = new Blob([binaryData], { type: mimeType });
                const storageId = await ctx.storage.store(blob);

                // Extract filename from path
                const fileName = video.path.split("/").pop() || "video.mp4";

                uploadedVideos.push({
                  storageId,
                  mimeType,
                  fileName,
                  description: video.description,
                });

                console.log("[preview-jobs] Uploaded video", {
                  previewRunId,
                  path: video.path,
                  storageId,
                  size: fileData.size,
                });
              } catch (uploadError) {
                console.error("[preview-jobs] Failed to upload video", {
                  previewRunId,
                  path: video.path,
                  error: uploadError instanceof Error ? uploadError.message : String(uploadError),
                });
              }
            }
          }

          let finalStatus = collectorResult.status;
          let finalError = collectorResult.error || collectorResult.reason;
          if (
            collectorResult.status === "completed" &&
            collectorResult.hasUiChanges === false &&
            uploadedImages.length === 0 &&
            uploadedVideos.length === 0
          ) {
            finalStatus = "skipped";
            finalError = finalError || "No UI changes detected - screenshots skipped";
          }

          console.log("[preview-jobs] Creating screenshot set", {
            previewRunId,
            status: finalStatus,
            originalStatus: collectorResult.status,
            imageCount: uploadedImages.length,
            videoCount: uploadedVideos.length,
            hasUiChanges: collectorResult.hasUiChanges,
          });

          try {
            await ctx.runMutation(internal.previewScreenshots.createScreenshotSet, {
              previewRunId,
              status: finalStatus,
              commitSha: run.headSha,
              error: finalError,
              hasUiChanges: collectorResult.hasUiChanges,
              images: uploadedImages,
              videos: uploadedVideos,
            });

            console.log("[preview-jobs] Screenshot set created, triggering GitHub comment update", {
              previewRunId,
            });

            // Trigger GitHub comment update (skip for test runs)
            if (!isTestRun) {
              await ctx.runAction(internal.previewScreenshots.triggerGithubComment, {
                previewRunId,
              });

              console.log("[preview-jobs] GitHub comment update triggered", {
                previewRunId,
              });
            } else {
              console.log("[preview-jobs] Skipping GitHub comment for test run", {
                previewRunId,
              });
            }
          } catch (screenshotSetError) {
            console.error("[preview-jobs] Failed to create screenshot set or update GitHub comment", {
              previewRunId,
              error: screenshotSetError instanceof Error ? screenshotSetError.message : String(screenshotSetError),
            });
          }
        }

        console.log("[preview-jobs] Screenshot collection completed via Morph exec", {
          previewRunId,
          taskRunId,
        });
      }
    }

    // Mark the task run as completed now that screenshot collection is done
    // This triggers updateTaskStatusFromRuns to mark the parent task as completed
    if (taskRunId) {
      try {
        await ctx.runMutation(internal.taskRuns.workerComplete, {
          taskRunId,
          exitCode: 0,
        });
        console.log("[preview-jobs] Task run marked as completed", {
          previewRunId,
          taskRunId,
        });
      } catch (completeError) {
        console.error("[preview-jobs] Failed to mark task run as completed", {
          previewRunId,
          taskRunId,
          error: completeError instanceof Error ? completeError.message : String(completeError),
        });
      }

      // Set crown evaluation status to "succeeded" so the green checkmark shows
      // Preview tasks are single-run, so we skip crown evaluation and mark as succeeded directly
      // Use setCompletedInternal which doesn't require user authorization
      if (taskId) {
        try {
          await ctx.runMutation(internal.tasks.setCompletedInternal, {
            taskId,
            isCompleted: true,
            crownEvaluationStatus: "succeeded",
          });
          console.log("[preview-jobs] Task crown evaluation status set to succeeded", {
            previewRunId,
            taskId,
          });
        } catch (crownError) {
          console.error("[preview-jobs] Failed to set crown evaluation status", {
            previewRunId,
            taskId,
            error: crownError instanceof Error ? crownError.message : String(crownError),
          });
        }
      }
    }

    // Mark the preview run as completed
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "completed",
    });

    console.log("[preview-jobs] Preview run initialized successfully", {
      previewRunId,
      instanceId: unifiedInstance?.id,
      provider: unifiedInstance?.provider,
      hasTaskRunId: Boolean(taskRunId),
    });
  } catch (error) {
    // Handle SupersededError specially - this is graceful termination, not a failure
    if (error instanceof SupersededError) {
      console.log("[preview-jobs] Preview job terminated due to supersession", {
        previewRunId,
        supersededBy: error.supersededBy,
        reason: error.reason,
      });
      // Set flag to ensure Morph instance is cleaned up in finally block
      wasSuperseded = true;
      // Don't mark as failed - the run is already marked as superseded
      // The finally block will clean up the Morph instance
      return;
    }

    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    console.error("[preview-jobs] Preview job failed", {
      previewRunId,
      error: message,
    });

    // Mark the task run as failed if we have one
    if (taskRunId) {
      try {
        await ctx.runMutation(internal.taskRuns.updateStatus, {
          id: taskRunId,
          status: "failed",
        });
        console.log("[preview-jobs] Task run marked as failed", {
          previewRunId,
          taskRunId,
        });
      } catch (taskRunError) {
        console.error("[preview-jobs] Failed to mark task run as failed", {
          previewRunId,
          taskRunId,
          error: taskRunError instanceof Error ? taskRunError.message : String(taskRunError),
        });
      }
    }

    try {
      await ctx.runMutation(internal.previewRuns.updateStatus, {
        previewRunId,
        status: "failed",
      });
    } catch (statusError) {
      console.error("[preview-jobs] Failed to update preview status", {
        previewRunId,
        error: statusError,
      });
    }

    throw error;
  } finally {
    // Always stop instance if run was superseded - the work is stale
    // Also stop if not keeping for task run
    if (unifiedInstance && stopFn && (wasSuperseded || !keepInstanceForTaskRun)) {
      const instanceId = unifiedInstance.id;
      try {
        console.log("[preview-jobs] Stopping sandbox instance", {
          previewRunId,
          instanceId,
          provider: unifiedInstance.provider,
          reason: wasSuperseded ? "superseded" : "not_kept_for_task",
        });
        await stopFn();
      } catch (stopError) {
        console.warn("[preview-jobs] Failed to stop sandbox instance", {
          previewRunId,
          instanceId,
          provider: unifiedInstance.provider,
          error: stopError,
        });
      }
    } else if (unifiedInstance) {
      console.log("[preview-jobs] Leaving sandbox instance running for preview task run", {
        previewRunId,
        instanceId: unifiedInstance.id,
        provider: unifiedInstance.provider,
        taskRunId,
      });
    }
  }
}
