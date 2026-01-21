#!/usr/bin/env bun
/**
 * Morph Screenshot Collector Script
 *
 * Starts a Morph instance clone and uses the host-screenshot-collector to capture
 * screenshots of PR UI changes - exactly like production.
 *
 * Usage:
 *   bun scripts/morph-screenshot-collector.ts <PR_URL> [options]
 *
 * Examples:
 *   bun scripts/morph-screenshot-collector.ts https://github.com/manaflow-ai/cmux/pull/123
 *   bun scripts/morph-screenshot-collector.ts https://github.com/owner/repo/pull/456 --preset 8vcpu_32gb_48gb
 *
 * Environment:
 *   MORPH_API_KEY    - Required (from .env)
 *   ANTHROPIC_API_KEY - Not used (proxy-only auth)
 */

import { execSync } from "node:child_process";
import { MorphCloudClient } from "morphcloud";
import readline from "node:readline";
import { connectToWorkerManagement } from "@cmux/shared/socket";
import {
  MORPH_SNAPSHOT_PRESETS,
  getSnapshotIdByPresetId,
  DEFAULT_MORPH_SNAPSHOT_ID,
} from "@cmux/shared";
import type {
  ServerToWorkerEvents,
  WorkerToServerEvents,
} from "@cmux/shared";
import type { Socket } from "socket.io-client";

// ============================================================================
// Types
// ============================================================================

interface PRInfo {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  changedFiles: string[];
  cloneUrl: string;
}

interface CLIArgs {
  prUrl: string;
  preset?: string;
  ttlMinutes?: number;
  keepAlive?: boolean;
  verbose?: boolean;
  skipClone?: boolean;
  installCommand?: string;
  devCommand?: string;
}

// ============================================================================
// Utilities
// ============================================================================

function log(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

function execCommand(command: string, options?: { cwd?: string }): string {
  try {
    return execSync(command, {
      encoding: "utf-8",
      cwd: options?.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const err = error as { stderr?: Buffer; message?: string };
    throw new Error(
      `Command failed: ${command}\n${err.stderr?.toString() || err.message}`
    );
  }
}

function parsePRUrl(url: string): { owner: string; repo: string; number: number } {
  const match = url.match(
    /https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
  );
  if (!match) {
    throw new Error(
      `Invalid PR URL format. Expected: https://github.com/<owner>/<repo>/pull/<number>\nGot: ${url}`
    );
  }
  return {
    owner: match[1],
    repo: match[2],
    number: parseInt(match[3], 10),
  };
}

function fetchPRInfo(prUrl: string): PRInfo {
  const { owner, repo, number } = parsePRUrl(prUrl);
  log(`Fetching PR info for ${owner}/${repo}#${number}...`);

  const prJson = execCommand(
    `gh pr view ${prUrl} --json title,body,baseRefName,headRefName`
  );
  const pr = JSON.parse(prJson) as {
    title: string;
    body: string;
    baseRefName: string;
    headRefName: string;
  };

  const filesJson = execCommand(`gh pr view ${prUrl} --json files`);
  const filesData = JSON.parse(filesJson) as {
    files: Array<{ path: string }>;
  };
  const changedFiles = filesData.files.map((f) => f.path);

  return {
    owner,
    repo,
    number,
    title: pr.title,
    body: pr.body || "",
    baseBranch: pr.baseRefName,
    headBranch: pr.headRefName,
    changedFiles,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };
}

async function askQuestion(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ============================================================================
// CLI argument parsing
// ============================================================================

function printUsage(): void {
  console.log(`
Usage: bun scripts/morph-screenshot-collector.ts <PR_URL> [options]

Arguments:
  PR_URL                  GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)

Options:
  --preset <id>           Snapshot preset to use (default: 8vcpu_32gb_48gb)
                          Available: ${MORPH_SNAPSHOT_PRESETS.map((p) => p.presetId).join(", ")}
  --ttl <minutes>         Instance TTL in minutes (default: 60)
  --keep-alive            Keep instance running after screenshot collection
  --skip-clone            Skip cloning, assume repo is already at /root/workspace
  --install-command <cmd> Command to install dependencies (e.g., "bun install")
  --dev-command <cmd>     Command to start dev server (e.g., "bun run dev")
  --verbose               Enable verbose logging
  --help                  Show this help message

Environment:
  MORPH_API_KEY           Required for starting Morph instances (from .env)
  ANTHROPIC_API_KEY       Not used (proxy-only auth)
  CMUX_TASK_RUN_JWT_SECRET Required for creating test preview tasks (from .env)
  GITHUB_TOKEN            Required for private repositories (or GH_TOKEN)
  TEST_TEAM_ID            Optional team ID for test tasks (default: "test-team")
  TEST_USER_ID            Optional user ID for test tasks (default: "test-user")

Examples:
  # Basic usage - start instance, clone repo, run screenshot collector
  bun scripts/morph-screenshot-collector.ts https://github.com/manaflow-ai/cmux/pull/123

  # Use a specific preset with longer TTL
  bun scripts/morph-screenshot-collector.ts https://github.com/owner/repo/pull/456 \\
    --preset 8vcpu_32gb_48gb --ttl 120

  # Keep instance alive for debugging
  bun scripts/morph-screenshot-collector.ts https://github.com/owner/repo/pull/789 --keep-alive
`);
}

function parseArgs(args: string[]): CLIArgs {
  const result: CLIArgs = {
    prUrl: "",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--preset") {
      result.preset = args[++i];
    } else if (arg.startsWith("--preset=")) {
      result.preset = arg.slice("--preset=".length);
    } else if (arg === "--ttl") {
      result.ttlMinutes = parseInt(args[++i], 10);
    } else if (arg.startsWith("--ttl=")) {
      result.ttlMinutes = parseInt(arg.slice("--ttl=".length), 10);
    } else if (arg === "--keep-alive") {
      result.keepAlive = true;
    } else if (arg === "--skip-clone") {
      result.skipClone = true;
    } else if (arg === "--install-command") {
      result.installCommand = args[++i];
    } else if (arg.startsWith("--install-command=")) {
      result.installCommand = arg.slice("--install-command=".length);
    } else if (arg === "--dev-command") {
      result.devCommand = args[++i];
    } else if (arg.startsWith("--dev-command=")) {
      result.devCommand = arg.slice("--dev-command=".length);
    } else if (arg === "--verbose") {
      result.verbose = true;
    } else if (!arg.startsWith("-") && !result.prUrl) {
      result.prUrl = arg;
    } else if (!arg.startsWith("-")) {
      console.error(`Unexpected argument: ${arg}`);
      process.exit(1);
    }
  }

  return result;
}

// ============================================================================
// Morph Instance Management
// ============================================================================

async function startMorphInstance(
  snapshotId: string,
  ttlSeconds: number
): Promise<{
  instance: Awaited<ReturnType<MorphCloudClient["instances"]["start"]>>;
  urls: {
    vscode: string;
    vnc: string;
    worker: string;
    cdp: string;
  };
}> {
  const morphApiKey = process.env.MORPH_API_KEY;
  if (!morphApiKey) {
    throw new Error(
      "MORPH_API_KEY environment variable is required. Set it in .env file."
    );
  }

  const client = new MorphCloudClient({ apiKey: morphApiKey });

  log("Starting Morph instance...", { snapshotId, ttlSeconds });
  const instance = await client.instances.start({
    snapshotId,
    ttlSeconds,
    ttlAction: "pause",
    metadata: {
      app: "cmux-screenshot-dev",
      script: "morph-screenshot-collector",
    },
  });

  log(`Instance created: ${instance.id}`);

  // Enable wake-on-demand
  void (async () => {
    await instance.setWakeOn(true, true);
  })();

  // Required ports - these may already be exposed in the snapshot
  const requiredPorts = [
    { name: "vscode", port: 39378 },
    { name: "worker", port: 39377 },
    { name: "vnc", port: 39380 },
    { name: "cdp", port: 39382 }, // Chrome DevTools Protocol
  ];

  // Check which ports are already exposed
  const alreadyExposedPorts = new Set(
    instance.networking.httpServices.map((s) => s.port)
  );

  const portsToExpose = requiredPorts.filter(
    ({ port }) => !alreadyExposedPorts.has(port)
  );

  if (portsToExpose.length > 0) {
    log("Exposing ports...", { ports: portsToExpose.map((p) => p.port) });
    for (const { name, port } of portsToExpose) {
      try {
        await instance.exposeHttpService(`${name}-${port}`, port);
      } catch (err) {
        // Ignore 409 conflicts - port already exposed
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("409") || errMsg.includes("already in use")) {
          log(`Port ${port} already exposed, skipping`);
        } else {
          throw err;
        }
      }
    }
  } else {
    log("All ports already exposed in snapshot");
  }

  // Get service URLs from instance networking
  const getServiceUrl = (port: number): string => {
    const service = instance.networking.httpServices.find((s) => s.port === port);
    if (!service?.url) {
      throw new Error(`Service on port ${port} not found. Available ports: ${instance.networking.httpServices.map((s) => s.port).join(", ")}`);
    }
    return service.url;
  };

  const urls = {
    vscode: `${getServiceUrl(39378)}/?folder=/root/workspace`,
    vnc: `${getServiceUrl(39380)}/vnc.html`,
    worker: getServiceUrl(39377),
    cdp: getServiceUrl(39382),
  };

  return { instance, urls };
}

async function setupWorkspaceInInstance(
  instance: Awaited<ReturnType<MorphCloudClient["instances"]["start"]>>,
  prInfo: PRInfo
): Promise<void> {
  const { cloneUrl, headBranch, baseBranch, owner, repo } = prInfo;

  log("Setting up workspace in Morph instance...");

  // Check for GitHub token for private repos
  const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  // Build clone URL with token if available (for private repos)
  let authenticatedCloneUrl = cloneUrl;
  if (githubToken) {
    authenticatedCloneUrl = `https://${githubToken}@github.com/${owner}/${repo}.git`;
    log("Using GitHub token for authentication");
  }

  // Clean /root/workspace if it exists and clone fresh
  log("Cloning repository...", { repo: `${owner}/${repo}`, branch: headBranch });

  // Remove existing workspace
  await instance.exec("rm -rf /root/workspace");

  // Clone the repository directly on the PR branch
  const cloneResult = await instance.exec(
    `git clone --depth=50 --branch ${headBranch} ${authenticatedCloneUrl} /root/workspace`
  );
  if (cloneResult.exit_code !== 0) {
    if (cloneResult.stderr.includes("could not read Username") ||
        cloneResult.stderr.includes("Authentication failed")) {
      throw new Error(
        `Failed to clone repository: Authentication required. ` +
        `Set GITHUB_TOKEN or GH_TOKEN environment variable for private repos.\n` +
        `Original error: ${cloneResult.stderr}`
      );
    }
    throw new Error(`Failed to clone repository: ${cloneResult.stderr}`);
  }

  // Fetch the base branch so git merge-base can find common ancestors
  log("Fetching base branch for merge-base...", { baseBranch });
  const fetchResult = await instance.exec(
    `cd /root/workspace && git fetch origin ${baseBranch}:refs/remotes/origin/${baseBranch} --depth=50`
  );
  if (fetchResult.exit_code !== 0) {
    log("Warning: Failed to fetch base branch, merge-base may fail", {
      stderr: fetchResult.stderr
    });
  }

  log("Workspace setup complete", { branch: headBranch, baseBranch });
}

async function connectToWorker(
  workerUrl: string
): Promise<Socket<WorkerToServerEvents, ServerToWorkerEvents>> {
  log("Connecting to worker management socket...", { url: workerUrl });

  const socket = connectToWorkerManagement({
    url: workerUrl,
    timeoutMs: 30_000,
    reconnectionAttempts: 5,
    forceNew: true,
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error("Timeout connecting to worker"));
    }, 30_000);

    socket.on("connect_error", (err) => {
      clearTimeout(timeout);
      console.error("Failed to connect to worker:", err);
      reject(err);
    });

    socket.on("connect", () => {
      clearTimeout(timeout);
      log("Connected to worker management socket");
      resolve(socket);
    });
  });
}

const CONVEX_SITE_URL = "https://famous-camel-162.convex.site";

interface TestPreviewTaskResult {
  taskId: string;
  taskRunId: string;
  jwt: string;
}

async function createTestPreviewTask(
  prUrl: string,
  repoUrl?: string
): Promise<TestPreviewTaskResult> {
  const jwtSecret = process.env.CMUX_TASK_RUN_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error(
      "CMUX_TASK_RUN_JWT_SECRET environment variable is required. " +
      "Get it from .env or the Convex dashboard."
    );
  }

  // Use test values for teamId and userId - these will create records in the DB
  const teamId = process.env.TEST_TEAM_ID || "test-team";
  const userId = process.env.TEST_USER_ID || "test-user";

  log("Creating test preview task...", { prUrl, teamId, userId });

  const response = await fetch(`${CONVEX_SITE_URL}/api/preview/test-task`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${jwtSecret}`,
    },
    body: JSON.stringify({
      teamId,
      userId,
      prUrl,
      repoUrl,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to create test preview task (${response.status}): ${errorText}`
    );
  }

  const result = await response.json() as {
    success: boolean;
    taskId: string;
    taskRunId: string;
    jwt: string;
    error?: string;
  };

  if (!result.success || !result.jwt) {
    throw new Error(`Failed to create test preview task: ${result.error || "Unknown error"}`);
  }

  log("Test preview task created", {
    taskId: result.taskId,
    taskRunId: result.taskRunId,
  });

  return {
    taskId: result.taskId,
    taskRunId: result.taskRunId,
    jwt: result.jwt,
  };
}

async function triggerScreenshotCollection(
  socket: Socket<WorkerToServerEvents, ServerToWorkerEvents>,
  options: {
    token: string;
    anthropicApiKey?: string;
    convexUrl?: string;
    installCommand?: string;
    devCommand?: string;
  }
): Promise<void> {
  const convexUrl = options.convexUrl || CONVEX_SITE_URL;
  log("Triggering screenshot collection via worker:run-task-screenshots...", { convexUrl });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for screenshot collection acknowledgment"));
    }, 30_000);

    socket.emit(
      "worker:run-task-screenshots",
      {
        token: options.token,
        anthropicApiKey: options.anthropicApiKey,
        convexUrl,
        installCommand: options.installCommand,
        devCommand: options.devCommand,
      },
      (result) => {
        clearTimeout(timeout);
        if (result.error) {
          reject(new Error(`Screenshot collection failed: ${result.error.message}`));
        } else {
          log("Screenshot collection started successfully");
          resolve();
        }
      }
    );
  });
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.prUrl) {
    console.error("Error: PR URL is required\n");
    printUsage();
    process.exit(1);
  }

  if (process.env.ANTHROPIC_API_KEY) {
    log("Ignoring ANTHROPIC_API_KEY (proxy-only mode)");
  }

  // Determine snapshot ID
  const presetId = args.preset || "8vcpu_32gb_48gb";
  const snapshotId = getSnapshotIdByPresetId(presetId) || DEFAULT_MORPH_SNAPSHOT_ID;
  log("Using snapshot preset", { presetId, snapshotId });

  // Calculate TTL
  const ttlMinutes = args.ttlMinutes || 60;
  const ttlSeconds = ttlMinutes * 60;

  let instance: Awaited<ReturnType<MorphCloudClient["instances"]["start"]>> | null = null;
  let socket: Socket<WorkerToServerEvents, ServerToWorkerEvents> | null = null;

  const cleanup = async () => {
    if (socket) {
      log("Disconnecting from worker...");
      socket.disconnect();
    }
    if (instance && !args.keepAlive) {
      log("Stopping instance...");
      try {
        await instance.stop();
        log("Instance stopped");
      } catch (error) {
        console.error("Error stopping instance:", error);
      }
    }
  };

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(1);
  });
  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit(1);
  });

  try {
    // Fetch PR info
    const prInfo = fetchPRInfo(args.prUrl);
    log("PR info fetched", {
      title: prInfo.title,
      baseBranch: prInfo.baseBranch,
      headBranch: prInfo.headBranch,
      changedFilesCount: prInfo.changedFiles.length,
    });

    if (args.verbose) {
      log("Changed files:", { files: prInfo.changedFiles });
    }

    // Start Morph instance
    const { instance: inst, urls } = await startMorphInstance(
      snapshotId,
      ttlSeconds
    );
    instance = inst;

    console.log("\n=== Morph Instance Started ===");
    console.log(`Instance ID: ${instance.id}`);
    console.log(`VSCode:      ${urls.vscode}`);
    console.log(`VNC:         ${urls.vnc}`);
    console.log(`CDP:         ${urls.cdp}/json/version`);
    console.log(`TTL:         ${ttlMinutes} minutes`);
    console.log("==============================\n");

    // Setup workspace (clone repo) unless skipped
    if (!args.skipClone) {
      await setupWorkspaceInInstance(instance, prInfo);
    } else {
      log("Skipping clone, using existing workspace");
    }

    // Wait a bit for the worker to be ready
    log("Waiting for worker to be ready...");
    await new Promise((r) => setTimeout(r, 5000));

    // Connect to worker
    socket = await connectToWorker(urls.worker);

    // Create test preview task to get a valid JWT token
    const repoUrl = `https://github.com/${prInfo.owner}/${prInfo.repo}`;
    const testTask = await createTestPreviewTask(args.prUrl, repoUrl);

    console.log("\n=== Test Preview Task Created ===");
    console.log(`Task ID:     ${testTask.taskId}`);
    console.log(`Task Run ID: ${testTask.taskRunId}`);
    console.log("=================================\n");

    // Trigger screenshot collection using the production flow
    await triggerScreenshotCollection(socket, {
      token: testTask.jwt,
      installCommand: args.installCommand,
      devCommand: args.devCommand,
    });

    console.log("\n=== Screenshot Collection Started ===");
    console.log("Monitor progress via:");
    console.log(`  - VNC:    ${urls.vnc}`);
    console.log(`  - VSCode: ${urls.vscode}`);
    console.log("\nScreenshots will be uploaded to Convex and visible in the dashboard.");
    console.log("Press Ctrl+C to stop (instance will be paused unless --keep-alive)");
    console.log("=====================================\n");

    if (args.keepAlive) {
      // Keep running until user stops
      await new Promise(() => {});
    } else {
      // Wait for user input to stop
      await askQuestion("\nPress Enter to stop instance and exit...");
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
