#!/usr/bin/env bun

import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { SpawnOptionsWithoutStdio } from "node:child_process";

const now = () => new Date().toISOString();
const log = (scope: string, message: string) => {
  console.log(`[${now()}] [${scope}] ${message}`);
};

const decodeBase64 = (value: string | undefined | null): string => {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  try {
    return Buffer.from(trimmed, "base64").toString("utf8");
  } catch (error) {
    log(
      "decode",
      `Failed to decode base64 value: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return "";
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

const runCommand = async (
  command: string,
  args: string[] = [],
  options: SpawnOptionsWithoutStdio = {},
): Promise<CommandResult> => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({
        exitCode: code,
        stdout,
        stderr,
      });
    });
  });
};

const workspaceRoot = process.env.CMUX_WORKSPACE_ROOT ?? "/root/workspace";
const runtimeDir = process.env.CMUX_RUNTIME_DIR ?? "/var/tmp/cmux-scripts";
const tmuxSession = process.env.CMUX_TMUX_SESSION ?? "cmux";
const maintenanceScriptPath =
  process.env.CMUX_MAINTENANCE_SCRIPT_PATH ?? join(runtimeDir, "maintenance.sh");
const devScriptPath = process.env.CMUX_DEV_SCRIPT_PATH ?? join(runtimeDir, "dev.sh");
const devWindowName = process.env.CMUX_DEV_WINDOW ?? "dev";
const maintenanceScriptBody = decodeBase64(
  process.env.CMUX_MAINTENANCE_SCRIPT_BASE64,
);
const devScriptBody = decodeBase64(process.env.CMUX_DEV_SCRIPT_BASE64);

const ensureRuntimeDir = () => {
  mkdirSync(runtimeDir, { recursive: true });
};

const ensureTmuxSession = async (): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await runCommand("tmux", ["has-session", "-t", tmuxSession]);
    if (result.exitCode === 0) {
      return;
    }
    await sleep(500);
  }
  throw new Error(`tmux session ${tmuxSession} not found after waiting`);
};

type MaintenanceResult = {
  ran: boolean;
  exitCode: number | null;
  durationMs: number;
  error: string | null;
  stderrSnippet: string | null;
};

type DevResult = {
  ran: boolean;
  windowCreated: boolean;
  sendKeysExitCode: number | null;
  durationMs: number;
  error: string | null;
};

const runMaintenance = async (): Promise<MaintenanceResult> => {
  if (!maintenanceScriptBody.trim()) {
    log("maintenance", "No maintenance script provided, skipping");
    return {
      ran: false,
      exitCode: null,
      durationMs: 0,
      error: null,
      stderrSnippet: null,
    };
  }

  ensureRuntimeDir();

  log("maintenance", `Writing script to ${maintenanceScriptPath}`);
  writeFileSync(
    maintenanceScriptPath,
    `#!/bin/zsh\nset -eux\ncd ${workspaceRoot}\n\n${maintenanceScriptBody}\n`,
    { encoding: "utf8" },
  );
  chmodSync(maintenanceScriptPath, 0o755);

  log("maintenance", "Starting maintenance script");
  const startedAt = performance.now();
  const result = await runCommand("zsh", [maintenanceScriptPath], {
    cwd: workspaceRoot,
  });
  const finishedAt = performance.now();
  const durationMs = finishedAt - startedAt;

  const stdoutText = result.stdout.trim();
  const stderrText = result.stderr.trim();

  if (stdoutText) {
    log("maintenance", `stdout:\n${stdoutText}`);
  }
  if (stderrText) {
    log("maintenance", `stderr:\n${stderrText}`);
  }

  const error =
    result.exitCode === 0
      ? null
      : `Maintenance script failed with exit code ${result.exitCode ?? "unknown"}`;

  if (error) {
    log("maintenance", error);
  } else {
    log(
      "maintenance",
      `Completed successfully in ${(durationMs / 1000).toFixed(2)}s`,
    );
  }

  return {
    ran: true,
    exitCode: result.exitCode,
    durationMs,
    error,
    stderrSnippet: stderrText ? stderrText.slice(-2000) : null,
  };
};

const runDev = async (): Promise<DevResult> => {
  if (!devScriptBody.trim()) {
    log("dev", "No dev script provided, skipping");
    return {
      ran: false,
      windowCreated: false,
      sendKeysExitCode: null,
      durationMs: 0,
      error: null,
    };
  }

  ensureRuntimeDir();

  log("dev", `Writing script to ${devScriptPath}`);
  writeFileSync(
    devScriptPath,
    `#!/bin/zsh\nset -ux\ncd ${workspaceRoot}\n\n${devScriptBody}\n`,
    { encoding: "utf8" },
  );
  chmodSync(devScriptPath, 0o755);

  const startedAt = performance.now();

  log("dev", "Ensuring tmux session is available");
  await ensureTmuxSession();

  const tmuxSessionTarget = `${tmuxSession}:`;
  const devWindowTarget = `${tmuxSession}:${devWindowName}`;

  log(
    "dev",
    `Resetting existing dev window (${devWindowName}) if present`,
  );
  await runCommand("tmux", [
    "kill-window",
    "-t",
    devWindowTarget,
  ]);

  log("dev", `Creating new tmux window (${devWindowName})`);
  const newWindowResult = await runCommand("tmux", [
    "new-window",
    "-t",
    tmuxSessionTarget,
    "-n",
    devWindowName,
    "-d",
  ]);

  const windowCreated = newWindowResult.exitCode === 0;

  if (!windowCreated) {
    const durationMs = performance.now() - startedAt;
    const failureMessage =
      `Failed to create tmux window ${devWindowName} (exit ${newWindowResult.exitCode ?? "unknown"})`;
    log("dev", failureMessage);
    return {
      ran: true,
      windowCreated: false,
      sendKeysExitCode: newWindowResult.exitCode,
      durationMs,
      error: failureMessage,
    };
  }

  await sleep(250);

  const devRunCommand = `zsh ${devScriptPath}`;
  log("dev", `Dispatching command: ${devRunCommand}`);
  const sendKeysResult = await runCommand("tmux", [
    "send-keys",
    "-t",
    devWindowTarget,
    devRunCommand,
    "C-m",
  ]);

  const durationMs = performance.now() - startedAt;

  if (sendKeysResult.exitCode === 0) {
    log("dev", `Command dispatched in ${(durationMs / 1000).toFixed(2)}s`);
  } else {
    log(
      "dev",
      `Failed to dispatch dev command (exit ${sendKeysResult.exitCode ?? "unknown"})`,
    );
  }

  return {
    ran: true,
    windowCreated: true,
    sendKeysExitCode: sendKeysResult.exitCode,
    durationMs,
    error:
      sendKeysResult.exitCode === 0
        ? null
        : `tmux send-keys failed with exit code ${sendKeysResult.exitCode ?? "unknown"}`,
  };
};

async function main(): Promise<void> {
  log("main", "cmux maintenance/dev coordinator starting");

  if (!maintenanceScriptBody.trim() && !devScriptBody.trim()) {
    log("main", "No scripts provided. Exiting early.");
    console.log(
      `CMUX_MAINT_DEV_RESULT ${JSON.stringify({
        maintenance: {
          ran: false,
          exitCode: null,
          durationMs: 0,
          error: "Both maintenance and dev scripts are empty",
          stderrSnippet: null,
        },
        dev: {
          ran: false,
          windowCreated: false,
          sendKeysExitCode: null,
          durationMs: 0,
          error: null,
        },
      })}`,
    );
    return;
  }

  let maintenanceResult: MaintenanceResult = {
    ran: false,
    exitCode: null,
    durationMs: 0,
    error: null,
    stderrSnippet: null,
  };

  try {
    maintenanceResult = await runMaintenance();
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : `Unknown maintenance error: ${String(error)}`;
    log("maintenance", `Unhandled failure: ${errorMessage}`);
    maintenanceResult = {
      ran: true,
      exitCode: null,
      durationMs: 0,
      error: errorMessage,
      stderrSnippet: null,
    };
  }

  let devResult: DevResult = {
    ran: false,
    windowCreated: false,
    sendKeysExitCode: null,
    durationMs: 0,
    error: null,
  };

  try {
    devResult = await runDev();
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : `Unknown dev error: ${String(error)}`;
    log("dev", `Unhandled failure: ${errorMessage}`);
    devResult = {
      ran: true,
      windowCreated: false,
      sendKeysExitCode: null,
      durationMs: 0,
      error: errorMessage,
    };
  }

  const resultPayload = {
    maintenance: maintenanceResult,
    dev: devResult,
  };

  console.log(`CMUX_MAINT_DEV_RESULT ${JSON.stringify(resultPayload)}`);

  if (devResult.error) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  log("main", `Fatal error: ${errorMessage}`);
  console.log(
    `CMUX_MAINT_DEV_RESULT ${JSON.stringify({
      maintenance: {
        ran: maintenanceScriptBody.trim().length > 0,
        exitCode: null,
        durationMs: 0,
        error: `Fatal coordinator error: ${errorMessage}`,
        stderrSnippet: null,
      },
      dev: {
        ran: devScriptBody.trim().length > 0,
        windowCreated: false,
        sendKeysExitCode: null,
        durationMs: 0,
        error: `Fatal coordinator error: ${errorMessage}`,
      },
    })}`,
  );
  process.exitCode = 1;
});
