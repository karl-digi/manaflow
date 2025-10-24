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

  // Build combined script that starts both windows immediately
  const hasMaintenanceScript = maintenanceScript && maintenanceScript.trim().length > 0;
  const hasDevScript = devScript && devScript.trim().length > 0;

  let maintenanceScriptContent = "";
  let devScriptContent = "";

  if (hasMaintenanceScript) {
    maintenanceScriptContent = `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \$(date) ==="
${maintenanceScript}
echo "=== Maintenance Script Completed at \$(date) ==="
`;
  }

  if (hasDevScript) {
    devScriptContent = `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \$(date) ==="
${devScript}
`;
  }

  // Create a single command that writes both scripts and starts both windows
  const combinedCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}
${hasMaintenanceScript ? `cat > ${ids.maintenance.scriptPath} <<'MAINTENANCE_SCRIPT_EOF'
${maintenanceScriptContent}
MAINTENANCE_SCRIPT_EOF
chmod +x ${ids.maintenance.scriptPath}` : ""}
${hasDevScript ? `cat > ${ids.dev.scriptPath} <<'DEV_SCRIPT_EOF'
${devScriptContent}
DEV_SCRIPT_EOF
chmod +x ${ids.dev.scriptPath}` : ""}
${waitForTmuxSession}
${hasMaintenanceScript ? `tmux new-window -t cmux: -n ${ids.maintenance.windowName} -d
tmux send-keys -t cmux:${ids.maintenance.windowName} "zsh ${ids.maintenance.scriptPath}; exec zsh" C-m
sleep 0.5` : ""}
${hasDevScript ? `tmux new-window -t cmux: -n ${ids.dev.windowName} -d
tmux send-keys -t cmux:${ids.dev.windowName} "zsh ${ids.dev.scriptPath}" C-m
sleep 0.5` : ""}
echo "=== Windows Started ==="
${hasMaintenanceScript ? `if tmux list-windows -t cmux | grep -q "${ids.maintenance.windowName}"; then
  echo "[MAINTENANCE] Window is running"
else
  echo "[MAINTENANCE] Window may have exited (normal if script completed quickly)"
fi` : ""}
${hasDevScript ? `if tmux list-windows -t cmux | grep -q "${ids.dev.windowName}"; then
  echo "[DEV] Window is running"
else
  echo "[DEV] WARNING: Window not found" >&2
fi` : ""}
echo "=== All windows started successfully ==="
`;

  let maintenanceError: string | null = null;
  let devError: string | null = null;

  try {
    const result = await instance.exec(
      `zsh -lc ${singleQuote(combinedCommand)}`,
    );

    if (result.exit_code !== 0) {
      const stderr = result.stderr?.trim() || "";
      const stdout = result.stdout?.trim() || "";

      // Determine which script(s) failed based on output
      if (hasMaintenanceScript && (!stdout.includes("[MAINTENANCE] Window is running") && !stdout.includes("[MAINTENANCE] Window may have exited"))) {
        maintenanceError = `Failed to start maintenance window: ${stderr || "Unknown error"}`;
      }

      if (hasDevScript && !stdout.includes("[DEV] Window is running")) {
        devError = `Failed to start dev window: ${stderr || "Unknown error"}`;
      }

      // If we couldn't determine specific failures, treat as general error
      if (!maintenanceError && !devError) {
        const messageParts = [
          `Script execution failed with exit code ${result.exit_code}`,
          stderr ? `stderr: ${stderr}` : null,
          stdout ? `stdout: ${stdout}` : null,
        ].filter((part): part is string => part !== null);
        const errorMessage = messageParts.join(" | ");

        if (hasMaintenanceScript) {
          maintenanceError = errorMessage;
        }
        if (hasDevScript) {
          devError = errorMessage;
        }
      }
    } else {
      console.log(`[SCRIPT VERIFICATION]\n${result.stdout || ""}`);
    }
  } catch (error) {
    const errorMessage = `Script execution failed: ${error instanceof Error ? error.message : String(error)}`;
    if (hasMaintenanceScript) {
      maintenanceError = errorMessage;
    }
    if (hasDevScript) {
      devError = errorMessage;
    }
  }

  return {
    maintenanceError,
    devError,
  };
}
