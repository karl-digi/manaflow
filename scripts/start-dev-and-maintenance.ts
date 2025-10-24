#!/usr/bin/env bun

import { $ } from "bun";

const WORKSPACE_ROOT = "/root/workspace";
const CMUX_RUNTIME_DIR = "/var/tmp/cmux-scripts";
const LOG_DIR = "/var/log/cmux";
const LOG_FILE = `${LOG_DIR}/start-dev-and-maintenance.log`;

interface ScriptConfig {
  maintenanceScript?: string;
  devScript?: string;
}

interface ScriptResult {
  maintenanceError: string | null;
  devError: string | null;
}

async function log(message: string, level: "INFO" | "ERROR" = "INFO") {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}`;
  console.log(logMessage);
  
  try {
    await $`mkdir -p ${LOG_DIR}`;
    await $`echo ${logMessage} >> ${LOG_FILE}`;
  } catch (error) {
    console.error(`Failed to write to log file: ${error}`);
  }
}

async function executeCommand(command: string, description: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  await log(`Starting: ${description}`);

  try {
    const result = await $`sh -c ${command}`.quiet();
    await log(`Completed: ${description} (exit code: ${result.exitCode})`);
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString()
    };
  } catch (error) {
    const errorMessage = error instanceof Error
      ? `Command failed: ${error.message}`
      : `Command failed: ${String(error)}`;
    await log(`Failed: ${description} - ${errorMessage}`, "ERROR");
    throw error;
  }
}

async function waitForTmuxSession(): Promise<void> {
  await log("Waiting for tmux session 'cmux' to be available");
  
  const maxAttempts = 20;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await $`tmux has-session -t cmux`.quiet();
      await log("Tmux session 'cmux' is available");
      return;
    } catch {
      if (i === maxAttempts) {
        throw new Error("Tmux session 'cmux' does not exist after waiting");
      }
      await $`sleep 0.5`;
    }
  }
}

async function runMaintenanceScript(maintenanceScript: string): Promise<string | null> {
  if (!maintenanceScript || maintenanceScript.trim().length === 0) {
    await log("No maintenance script provided, skipping");
    return null;
  }

  const maintenanceRunId = `maintenance_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const maintenanceExitCodePath = `${CMUX_RUNTIME_DIR}/maintenance.${maintenanceRunId}.exit-code`;
  const maintenanceScriptPath = `${CMUX_RUNTIME_DIR}/maintenance.sh`;
  const maintenanceWrapperPath = `${CMUX_RUNTIME_DIR}/maintenance-wrapper.sh`;

  const maintenanceScriptContent = `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \$(date) ==="
${maintenanceScript}
echo "=== Maintenance Script Completed at \$(date) ==="
`;

  const maintenanceWrapperContent = `#!/bin/zsh
zsh "${maintenanceScriptPath}"
EXIT_CODE=$?
echo "$EXIT_CODE" > "${maintenanceExitCodePath}"
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "[MAINTENANCE] Script exited with code $EXIT_CODE" >&2
else
  echo "[MAINTENANCE] Script completed successfully"
fi
exec zsh
`;

  try {
    await log("Creating maintenance script");
    await executeCommand(`mkdir -p ${CMUX_RUNTIME_DIR}`, "Create runtime directory");

    // Write script files using Bun's file writing
    await Bun.write(maintenanceScriptPath, maintenanceScriptContent);
    await Bun.write(maintenanceWrapperPath, maintenanceWrapperContent);

    await executeCommand(`chmod +x ${maintenanceScriptPath}`, "Make maintenance script executable");
    await executeCommand(`chmod +x ${maintenanceWrapperPath}`, "Make maintenance wrapper executable");
    await executeCommand(`rm -f ${maintenanceExitCodePath}`, "Clean up old exit code file");

    await waitForTmuxSession();

    await log("Starting maintenance script in tmux window");
    await executeCommand(
      `tmux new-window -t cmux: -n maintenance -d`,
      "Create maintenance tmux window"
    );
    await executeCommand(
      `tmux send-keys -t cmux:maintenance "zsh ${maintenanceWrapperPath}" C-m`,
      "Send maintenance wrapper script to tmux window"
    );

    await $`sleep 2`;

    // Check if window exists
    try {
      await $`tmux list-windows -t cmux | grep -q "maintenance"`.quiet();
      await log("Maintenance window is running");
    } catch {
      await log("Maintenance window may have exited (normal if script completed quickly)");
    }

    // Wait for maintenance script to complete
    await log("Waiting for maintenance script to complete");
    let attempts = 0;
    const maxAttempts = 300; // 5 minutes max wait
    
    while (attempts < maxAttempts) {
      try {
        await $`cat ${maintenanceExitCodePath}`.quiet();
        break;
      } catch {
        attempts++;
        await $`sleep 1`;
      }
    }

    let maintenanceExitCode = 0;
    try {
      const result = await $`cat ${maintenanceExitCodePath}`.quiet();
      maintenanceExitCode = parseInt(result.stdout.toString().trim(), 10);
    } catch {
      await log("Missing exit code file; assuming maintenance script failed", "ERROR");
      maintenanceExitCode = 1;
    }

    await executeCommand(`rm -f ${maintenanceExitCodePath}`, "Clean up exit code file");
    await log(`Maintenance script completed with exit code: ${maintenanceExitCode}`);

    if (maintenanceExitCode !== 0) {
      return `Maintenance script failed with exit code ${maintenanceExitCode}`;
    }

    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await log(`Maintenance script execution failed: ${errorMessage}`, "ERROR");
    return `Maintenance script execution failed: ${errorMessage}`;
  }
}

async function runDevScript(devScript: string): Promise<string | null> {
  if (!devScript || devScript.trim().length === 0) {
    await log("No dev script provided, skipping");
    return null;
  }

  const devScriptPath = `${CMUX_RUNTIME_DIR}/dev.sh`;

  const devScriptContent = `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \$(date) ==="
${devScript}
`;

  try {
    await log("Creating dev script");
    await executeCommand(`mkdir -p ${CMUX_RUNTIME_DIR}`, "Create runtime directory");

    // Write script file using Bun's file writing
    await Bun.write(devScriptPath, devScriptContent);

    await executeCommand(`chmod +x ${devScriptPath}`, "Make dev script executable");

    await waitForTmuxSession();

    await log("Starting dev script in tmux window");
    await executeCommand(
      `tmux new-window -t cmux: -n dev -d`,
      "Create dev tmux window"
    );

    await executeCommand(
      `tmux send-keys -t cmux:dev "zsh ${devScriptPath}" C-m`,
      "Send dev script command to tmux window"
    );

    await $`sleep 2`;

    // Check if window exists
    try {
      await $`tmux list-windows -t cmux | grep -q "dev"`.quiet();
      await log("Dev window is running successfully");
      return null;
    } catch {
      await log("Dev window not found after creation", "ERROR");
      return "Failed to start dev script - tmux window not found";
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await log(`Dev script execution failed: ${errorMessage}`, "ERROR");
    return `Dev script execution failed: ${errorMessage}`;
  }
}

async function main(): Promise<void> {
  await log("Starting dev and maintenance script runner");

  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    let maintenanceScript: string | undefined;
    let devScript: string | undefined;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--maintenance' && i + 1 < args.length) {
        maintenanceScript = args[i + 1];
        i++;
      } else if (args[i] === '--dev' && i + 1 < args.length) {
        devScript = args[i + 1];
        i++;
      }
    }

    if (!maintenanceScript && !devScript) {
      await log("No scripts provided", "ERROR");
      process.exit(1);
    }

    const result: ScriptResult = {
      maintenanceError: null,
      devError: null,
    };

    // Run maintenance script first
    if (maintenanceScript) {
      await log("=== Starting Maintenance Script ===");
      result.maintenanceError = await runMaintenanceScript(maintenanceScript);
      
      if (result.maintenanceError) {
        await log(`Maintenance script failed: ${result.maintenanceError}`, "ERROR");
        // Continue with dev script even if maintenance fails
      } else {
        await log("Maintenance script completed successfully");
      }
    }

    // Run dev script after maintenance completes
    if (devScript) {
      await log("=== Starting Dev Script ===");
      result.devError = await runDevScript(devScript);
      
      if (result.devError) {
        await log(`Dev script failed: ${result.devError}`, "ERROR");
      } else {
        await log("Dev script started successfully");
      }
    }

    // Output final result as JSON for easy parsing by the calling process
    console.log(JSON.stringify(result));

    if (result.maintenanceError || result.devError) {
      process.exit(1);
    }

    await log("All scripts completed successfully");
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await log(`Unexpected error: ${errorMessage}`, "ERROR");
    process.exit(1);
  }
}

// Run the main function
main();