#!/usr/bin/env bun
/**
 * This script runs maintenance and dev scripts sequentially in separate tmux windows.
 * It's designed to run inside a Morph instance, not in a Vercel function.
 *
 * All errors are logged to /var/log/cmux/maintenance-and-dev.log
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createWriteStream } from "node:fs";

const WORKSPACE_ROOT = "/root/workspace";
const CMUX_RUNTIME_DIR = "/var/tmp/cmux-scripts";
const LOG_DIR = "/var/log/cmux";
const LOG_FILE = `${LOG_DIR}/maintenance-and-dev.log`;

const MAINTENANCE_WINDOW_NAME = "maintenance";
const DEV_WINDOW_NAME = "dev";
const TMUX_SESSION = "cmux";

// Ensure log directory exists
await mkdir(LOG_DIR, { recursive: true });

// Create log stream
const logStream = createWriteStream(LOG_FILE, { flags: "a" });

function log(level: "INFO" | "ERROR" | "WARN", message: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level}] ${message}\n`;
  logStream.write(logEntry);
  console.log(logEntry.trim());
}

function logError(message: string, error?: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  log("ERROR", `${message}: ${errorMessage}`);
  if (error instanceof Error && error.stack) {
    logStream.write(`${error.stack}\n`);
  }
}

/**
 * Wait for tmux session to exist
 */
async function waitForTmuxSession(maxRetries = 20, retryDelay = 500): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await execCommand("tmux", ["has-session", "-t", TMUX_SESSION]);
      log("INFO", `Tmux session '${TMUX_SESSION}' found`);
      return true;
    } catch {
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }
  logError(`Tmux session '${TMUX_SESSION}' does not exist after ${maxRetries} retries`);
  return false;
}

/**
 * Execute a command and return stdout/stderr
 */
function execCommand(
  command: string,
  args: string[],
  options?: { logOutput?: boolean }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd: WORKSPACE_ROOT });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      if (options?.logOutput) {
        logStream.write(text);
      }
    });

    proc.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      if (options?.logOutput) {
        logStream.write(text);
      }
    });

    proc.on("error", (error) => {
      logError(`Failed to spawn command: ${command} ${args.join(" ")}`, error);
      reject(error);
    });

    proc.on("close", (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 0,
      });
    });
  });
}

/**
 * Create and run a script in a tmux window
 */
async function runScriptInTmuxWindow(
  windowName: string,
  scriptContent: string,
  scriptPath: string,
  waitForCompletion: boolean
): Promise<number> {
  log("INFO", `Starting ${windowName} script in tmux window '${windowName}'`);

  // Write script to file
  await writeFile(scriptPath, scriptContent, { mode: 0o755 });
  log("INFO", `Wrote script to ${scriptPath}`);

  const exitCodePath = `${scriptPath}.exit-code`;

  // Remove old exit code file if it exists
  if (existsSync(exitCodePath)) {
    await unlink(exitCodePath);
  }

  // Build the command to run in tmux
  let windowCommand: string;
  if (waitForCompletion) {
    // For maintenance: track exit code
    windowCommand = `zsh "${scriptPath}"
EXIT_CODE=$?
echo "$EXIT_CODE" > "${exitCodePath}"
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "[${windowName.toUpperCase()}] Script exited with code $EXIT_CODE" >&2
else
  echo "[${windowName.toUpperCase()}] Script completed successfully"
fi
exec zsh`;
  } else {
    // For dev: just run the script
    windowCommand = `zsh "${scriptPath}"`;
  }

  // Create tmux window and run command
  try {
    const result = await execCommand("tmux", [
      "new-window",
      "-t",
      `${TMUX_SESSION}:`,
      "-n",
      windowName,
      "-d",
      windowCommand,
    ]);

    if (result.exitCode !== 0) {
      logError(`Failed to create tmux window '${windowName}'`, new Error(result.stderr));
      return 1;
    }

    log("INFO", `Created tmux window '${windowName}'`);

    // Give tmux a moment to start the window
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify window exists
    const listResult = await execCommand("tmux", ["list-windows", "-t", TMUX_SESSION]);
    if (!listResult.stdout.includes(windowName)) {
      log("WARN", `Window '${windowName}' not found in window list (may have exited quickly)`);
    }

    // Wait for completion if requested
    if (waitForCompletion) {
      log("INFO", `Waiting for ${windowName} script to complete...`);

      // Poll for exit code file
      let attempts = 0;
      const maxAttempts = 1800; // 30 minutes (1800 seconds)
      while (!existsSync(exitCodePath) && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }

      if (!existsSync(exitCodePath)) {
        logError(`${windowName} script did not complete after ${maxAttempts} seconds`);
        return 1;
      }

      const exitCodeContent = await readFile(exitCodePath, "utf-8");
      const exitCode = parseInt(exitCodeContent.trim(), 10) || 0;

      // Clean up exit code file
      await unlink(exitCodePath);

      log("INFO", `${windowName} script completed with exit code ${exitCode}`);
      return exitCode;
    }

    return 0;
  } catch (error) {
    logError(`Error running ${windowName} script in tmux`, error);
    return 1;
  }
}

/**
 * Main function
 */
async function main() {
  log("INFO", "Starting maintenance and dev script runner");

  const args = process.argv.slice(2);

  if (args.length < 1 || args.length > 2) {
    log("ERROR", "Usage: bun run-maintenance-and-dev.ts <maintenanceScriptPath> [devScriptPath]");
    process.exit(1);
  }

  const maintenanceScriptPath = args[0];
  const devScriptPath = args[1];

  // Ensure CMUX_RUNTIME_DIR exists
  await mkdir(CMUX_RUNTIME_DIR, { recursive: true });

  // Wait for tmux session
  const sessionExists = await waitForTmuxSession();
  if (!sessionExists) {
    log("ERROR", "Cannot proceed without tmux session");
    process.exit(1);
  }

  let maintenanceExitCode = 0;

  // Run maintenance script if provided
  if (maintenanceScriptPath) {
    log("INFO", `Reading maintenance script from ${maintenanceScriptPath}`);

    let maintenanceScript: string;
    try {
      maintenanceScript = await readFile(maintenanceScriptPath, "utf-8");
    } catch (error) {
      logError(`Failed to read maintenance script from ${maintenanceScriptPath}`, error);
      process.exit(1);
    }

    if (maintenanceScript.trim().length === 0) {
      log("WARN", "Maintenance script is empty, skipping");
    } else {
      const scriptContent = `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at $(date) ==="
${maintenanceScript}
echo "=== Maintenance Script Completed at $(date) ==="
`;

      const runtimeScriptPath = `${CMUX_RUNTIME_DIR}/maintenance.sh`;

      maintenanceExitCode = await runScriptInTmuxWindow(
        MAINTENANCE_WINDOW_NAME,
        scriptContent,
        runtimeScriptPath,
        true // wait for completion
      );

      if (maintenanceExitCode !== 0) {
        logError(`Maintenance script failed with exit code ${maintenanceExitCode}`);
        process.exit(maintenanceExitCode);
      }
    }
  }

  // Run dev script if provided
  if (devScriptPath) {
    log("INFO", `Reading dev script from ${devScriptPath}`);

    let devScript: string;
    try {
      devScript = await readFile(devScriptPath, "utf-8");
    } catch (error) {
      logError(`Failed to read dev script from ${devScriptPath}`, error);
      process.exit(1);
    }

    if (devScript.trim().length === 0) {
      log("WARN", "Dev script is empty, skipping");
    } else {
      const scriptContent = `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at $(date) ==="
${devScript}
`;

      const runtimeScriptPath = `${CMUX_RUNTIME_DIR}/dev.sh`;

      const devExitCode = await runScriptInTmuxWindow(
        DEV_WINDOW_NAME,
        scriptContent,
        runtimeScriptPath,
        false // don't wait for completion
      );

      if (devExitCode !== 0) {
        logError(`Dev script failed to start with exit code ${devExitCode}`);
        process.exit(devExitCode);
      }
    }
  }

  log("INFO", "Script runner completed successfully");
  logStream.end();
  process.exit(0);
}

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  logError("Uncaught exception", error);
  logStream.end();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logError("Unhandled rejection", reason);
  logStream.end();
  process.exit(1);
});

main().catch((error) => {
  logError("Fatal error in main", error);
  logStream.end();
  process.exit(1);
});
