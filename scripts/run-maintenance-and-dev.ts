#!/usr/bin/env bun

/**
 * This script manages running maintenance and dev scripts in tmux windows.
 * It creates a tmux session with separate windows for:
 * 1. Maintenance script (runs first, must complete)
 * 2. Dev script (runs after maintenance completes)
 *
 * All errors are logged to /var/log/cmux/startup.log
 */

import { $ } from "bun";
import * as fs from "fs/promises";
import * as path from "path";

const LOG_FILE = "/var/log/cmux/startup.log";
const TMUX_SESSION = "cmux";

interface ScriptResult {
  success: boolean;
  error?: string;
  exitCode?: number;
}

/**
 * Logs message to both console and log file
 */
async function log(message: string, isError = false) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  // Log to console
  if (isError) {
    console.error(message);
  } else {
    console.log(message);
  }

  // Log to file
  try {
    await fs.appendFile(LOG_FILE, logMessage);
  } catch (err) {
    console.error(`Failed to write to log file: ${err}`);
  }
}

/**
 * Ensures the tmux session exists
 */
async function ensureTmuxSession(): Promise<void> {
  try {
    await $`tmux has-session -t ${TMUX_SESSION}`.quiet();
    await log(`Tmux session '${TMUX_SESSION}' already exists`);
  } catch {
    await log(`Creating tmux session '${TMUX_SESSION}'`);
    await $`tmux new-session -d -s ${TMUX_SESSION}`.quiet();
  }
}

/**
 * Creates a new tmux window in the session
 */
async function createTmuxWindow(windowName: string): Promise<void> {
  await log(`Creating tmux window '${windowName}'`);
  await $`tmux new-window -t ${TMUX_SESSION}: -n ${windowName}`.quiet();
}

/**
 * Runs a script in a tmux window and waits for completion
 */
async function runScriptInTmux(
  windowName: string,
  scriptPath: string,
  args: string[] = [],
  waitForCompletion = true
): Promise<ScriptResult> {
  const startTime = Date.now();
  await log(`Starting script in window '${windowName}': ${scriptPath} ${args.join(" ")}`);

  try {
    // Create exit code marker file
    const exitCodeFile = `/tmp/tmux-${windowName}-exit-code`;
    await fs.unlink(exitCodeFile).catch(() => {}); // Remove if exists

    // Build the command to run in tmux
    const command = `${scriptPath} ${args.join(" ")}; echo $? > ${exitCodeFile}`;

    // Send command to tmux window
    await $`tmux send-keys -t ${TMUX_SESSION}:${windowName} ${command} C-m`.quiet();

    if (!waitForCompletion) {
      await log(`Script started in background in window '${windowName}'`);
      return { success: true };
    }

    // Wait for exit code file to appear
    await log(`Waiting for script to complete in window '${windowName}'...`);
    let attempts = 0;
    const maxAttempts = 600; // 10 minutes max (600 * 1 second)

    while (attempts < maxAttempts) {
      try {
        const exitCodeContent = await fs.readFile(exitCodeFile, "utf-8");
        const exitCode = parseInt(exitCodeContent.trim(), 10);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        if (exitCode === 0) {
          await log(`Script completed successfully in window '${windowName}' (${duration}s)`);
          return { success: true, exitCode };
        } else {
          const errorMsg = `Script failed in window '${windowName}' with exit code ${exitCode} (${duration}s)`;
          await log(errorMsg, true);

          // Capture the last 50 lines of output from the tmux pane
          try {
            const output = await $`tmux capture-pane -t ${TMUX_SESSION}:${windowName} -p -S -50`.text();
            await log(`Last 50 lines from window '${windowName}':\n${output}`, true);
          } catch (captureErr) {
            await log(`Failed to capture pane output: ${captureErr}`, true);
          }

          return { success: false, exitCode, error: errorMsg };
        }
      } catch {
        // File doesn't exist yet, keep waiting
        await Bun.sleep(1000);
        attempts++;
      }
    }

    const timeoutMsg = `Timeout waiting for script to complete in window '${windowName}' after ${maxAttempts} seconds`;
    await log(timeoutMsg, true);
    return { success: false, error: timeoutMsg };

  } catch (err) {
    const errorMsg = `Error running script in window '${windowName}': ${err}`;
    await log(errorMsg, true);
    return { success: false, error: errorMsg };
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    await log("=== Starting maintenance and dev scripts ===");

    // Ensure tmux session exists
    await ensureTmuxSession();

    // Create maintenance window and run maintenance script
    await createTmuxWindow("maintenance");
    const maintenanceResult = await runScriptInTmux(
      "maintenance",
      "./scripts/maintenance.sh",
      [],
      true // Wait for completion
    );

    if (!maintenanceResult.success) {
      await log("Maintenance script failed, aborting dev script startup", true);
      process.exit(1);
    }

    // Create dev window and run dev script
    await createTmuxWindow("dev");
    const devResult = await runScriptInTmux(
      "dev",
      "./scripts/dev.sh",
      [],
      false // Don't wait, run in background
    );

    if (!devResult.success) {
      await log("Failed to start dev script", true);
      process.exit(1);
    }

    await log("=== All scripts started successfully ===");
    process.exit(0);

  } catch (err) {
    await log(`Fatal error: ${err}`, true);
    process.exit(1);
  }
}

main();
