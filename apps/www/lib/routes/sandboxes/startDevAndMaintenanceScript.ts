import type { MorphInstance } from "./git";
import { singleQuote } from "./shell";

const WORKSPACE_ROOT = "/root/workspace";
const CMUX_RUNTIME_DIR = "/var/tmp/cmux-scripts";
const MAINTENANCE_WINDOW_NAME = "maintenance";
const MAINTENANCE_SCRIPT_FILENAME = "maintenance.sh";
const DEV_WINDOW_NAME = "dev";
const DEV_SCRIPT_FILENAME = "dev.sh";

export type ScriptIdentifiers = {
  maintenance: {
    windowName: string;
    scriptPath: string;
  };
  dev: {
    windowName: string;
    scriptPath: string;
  };
};

export const allocateScriptIdentifiers = (): ScriptIdentifiers => {
  return {
    maintenance: {
      windowName: MAINTENANCE_WINDOW_NAME,
      scriptPath: `${CMUX_RUNTIME_DIR}/${MAINTENANCE_SCRIPT_FILENAME}`,
    },
    dev: {
      windowName: DEV_WINDOW_NAME,
      scriptPath: `${CMUX_RUNTIME_DIR}/${DEV_SCRIPT_FILENAME}`,
    },
  };
};

type ScriptResult = {
  maintenanceError: string | null;
  devError: string | null;
};

export async function runMaintenanceAndDevScripts({
  instance,
  maintenanceScript,
  devScript,
  identifiers,
}: {
  instance: MorphInstance;
  maintenanceScript?: string;
  devScript?: string;
  identifiers?: ScriptIdentifiers;
}): Promise<ScriptResult> {
  const ids = identifiers ?? allocateScriptIdentifiers();

  if (
    (!maintenanceScript || maintenanceScript.trim().length === 0) &&
    (!devScript || devScript.trim().length === 0)
  ) {
    return {
      maintenanceError: "Both maintenance and dev scripts are empty",
      devError: null,
    };
  }

  const waitForTmuxSession = `for i in {1..20}; do
  if tmux has-session -t cmux 2>/dev/null; then
    break
  fi
  sleep 0.5
done
if ! tmux has-session -t cmux 2>/dev/null; then
  echo "Error: cmux session does not exist" >&2
  exit 1
fi`;

  // Create the maintenance script content
  const maintenanceScriptContent = maintenanceScript && maintenanceScript.trim().length > 0
    ? `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \$(date) ==="
${maintenanceScript}
echo "=== Maintenance Script Completed at \$(date) ==="
`
    : "";

  // Create the dev script content
  const devScriptContent = devScript && devScript.trim().length > 0
    ? `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \$(date) ==="
${devScript}
`
    : "";

  // Create a Bun orchestrator script that runs both scripts sequentially
  // This script will handle maintenance first (ignoring errors), then dev
  const orchestratorScriptPath = `${CMUX_RUNTIME_DIR}/orchestrator.ts`;
  const maintenanceRunId = `maintenance_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const maintenanceExitCodePath = `${ids.maintenance.scriptPath}.${maintenanceRunId}.exit-code`;

  const orchestratorScript = `#!/usr/bin/env bun
import { $ } from "bun";

const MAINTENANCE_SCRIPT = "${ids.maintenance.scriptPath}";
const DEV_SCRIPT = "${ids.dev.scriptPath}";
const MAINTENANCE_EXIT_CODE_PATH = "${maintenanceExitCodePath}";
const MAINTENANCE_WINDOW = "${ids.maintenance.windowName}";
const DEV_WINDOW = "${ids.dev.windowName}";

async function runMaintenance() {
  console.log("[ORCHESTRATOR] Starting maintenance script...");

  try {
    // Start maintenance in tmux window
    const maintenanceWindowCommand = \`zsh "\${MAINTENANCE_SCRIPT}"
EXIT_CODE=$?
echo "$EXIT_CODE" > "\${MAINTENANCE_EXIT_CODE_PATH}"
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "[MAINTENANCE] Script exited with code $EXIT_CODE" >&2
else
  echo "[MAINTENANCE] Script completed successfully"
fi
exec zsh\`;

    await $\`tmux new-window -t cmux: -n \${MAINTENANCE_WINDOW} -d \${maintenanceWindowCommand}\`;

    await $\`sleep 2\`;

    // Check if window exists
    const windowCheck = await $\`tmux list-windows -t cmux | grep "\${MAINTENANCE_WINDOW}" || true\`.quiet();
    if (windowCheck.stdout.toString().trim()) {
      console.log("[ORCHESTRATOR] Maintenance window is running");
    } else {
      console.log("[ORCHESTRATOR] Maintenance window may have exited (normal if script completed)");
    }

    // Wait for exit code file
    console.log("[ORCHESTRATOR] Waiting for maintenance to complete...");
    while (!(await Bun.file(MAINTENANCE_EXIT_CODE_PATH).exists())) {
      await $\`sleep 1\`;
    }

    const exitCodeContent = await Bun.file(MAINTENANCE_EXIT_CODE_PATH).text();
    const exitCode = parseInt(exitCodeContent.trim(), 10) || 0;

    await $\`rm -f \${MAINTENANCE_EXIT_CODE_PATH}\`;

    console.log(\`[ORCHESTRATOR] Maintenance completed with exit code \${exitCode}\`);

    // We don't throw or exit here - maintenance errors should not block dev script
    if (exitCode !== 0) {
      console.log("[ORCHESTRATOR] Maintenance had errors, but continuing to dev script...");
    }
  } catch (error) {
    console.error("[ORCHESTRATOR] Error running maintenance:", error);
    console.log("[ORCHESTRATOR] Continuing to dev script despite maintenance error...");
  }
}

async function runDev() {
  console.log("[ORCHESTRATOR] Starting dev script...");

  try {
    await $\`tmux new-window -t cmux: -n \${DEV_WINDOW} -d\`;
    await $\`tmux send-keys -t cmux:\${DEV_WINDOW} "zsh \${DEV_SCRIPT}" C-m\`;
    await $\`sleep 2\`;

    const windowCheck = await $\`tmux list-windows -t cmux | grep "\${DEV_WINDOW}" || true\`.quiet();
    if (windowCheck.stdout.toString().trim()) {
      console.log("[ORCHESTRATOR] Dev window is running");
    } else {
      console.error("[ORCHESTRATOR] ERROR: Dev window not found");
      process.exit(1);
    }
  } catch (error) {
    console.error("[ORCHESTRATOR] Error running dev script:", error);
    process.exit(1);
  }
}

async function main() {
  console.log("[ORCHESTRATOR] Starting orchestration of maintenance and dev scripts...");

  ${maintenanceScript && maintenanceScript.trim().length > 0 ? "await runMaintenance();" : "console.log('[ORCHESTRATOR] Skipping maintenance (no script provided)');"}
  ${devScript && devScript.trim().length > 0 ? "await runDev();" : "console.log('[ORCHESTRATOR] Skipping dev (no script provided)');"}

  console.log("[ORCHESTRATOR] Orchestration complete");
}

main().catch((error) => {
  console.error("[ORCHESTRATOR] Fatal error:", error);
  process.exit(1);
});
`;

  // Single command that sets up everything and runs the orchestrator
  const setupAndRunCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}

# Write maintenance script if provided
${maintenanceScriptContent ? `cat > ${ids.maintenance.scriptPath} <<'MAINTENANCE_SCRIPT_EOF'
${maintenanceScriptContent}
MAINTENANCE_SCRIPT_EOF
chmod +x ${ids.maintenance.scriptPath}` : ""}

# Write dev script if provided
${devScriptContent ? `cat > ${ids.dev.scriptPath} <<'DEV_SCRIPT_EOF'
${devScriptContent}
DEV_SCRIPT_EOF
chmod +x ${ids.dev.scriptPath}` : ""}

# Write orchestrator script
cat > ${orchestratorScriptPath} <<'ORCHESTRATOR_EOF'
${orchestratorScript}
ORCHESTRATOR_EOF
chmod +x ${orchestratorScriptPath}

# Clean up any previous exit code files
rm -f ${maintenanceExitCodePath}

# Wait for tmux session
${waitForTmuxSession}

# Run the orchestrator in the background
echo "[SETUP] Starting orchestrator..."
nohup bun ${orchestratorScriptPath} > ${CMUX_RUNTIME_DIR}/orchestrator.log 2>&1 &
ORCHESTRATOR_PID=$!
echo "[SETUP] Orchestrator started with PID $ORCHESTRATOR_PID"

# Give it a moment to start
sleep 1

# Check if orchestrator is still running
if kill -0 $ORCHESTRATOR_PID 2>/dev/null; then
  echo "[SETUP] Orchestrator is running"
else
  echo "[SETUP] ERROR: Orchestrator failed to start" >&2
  cat ${CMUX_RUNTIME_DIR}/orchestrator.log >&2
  exit 1
fi
`;

  try {
    const result = await instance.exec(
      `zsh -lc ${singleQuote(setupAndRunCommand)}`,
    );

    if (result.exit_code !== 0) {
      const stderr = result.stderr?.trim() || "";
      const stdout = result.stdout?.trim() || "";
      const messageParts = [
        `Failed to start orchestrator with exit code ${result.exit_code}`,
        stderr ? `stderr: ${stderr}` : null,
        stdout ? `stdout: ${stdout}` : null,
      ].filter((part): part is string => part !== null);
      return {
        maintenanceError: null,
        devError: messageParts.join(" | "),
      };
    }

    console.log(`[ORCHESTRATOR STARTUP]\n${result.stdout || ""}`);

    // Return success - the orchestrator is now running in the background
    return {
      maintenanceError: null,
      devError: null,
    };
  } catch (error) {
    return {
      maintenanceError: null,
      devError: `Orchestrator execution failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
