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

  const hasMaintenanceScript = maintenanceScript && maintenanceScript.trim().length > 0;
  const hasDevScript = devScript && devScript.trim().length > 0;

  // Prepare maintenance script content if needed
  const maintenanceScriptContent = hasMaintenanceScript
    ? `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \$(date) ==="
${maintenanceScript}
echo "=== Maintenance Script Completed at \$(date) ==="
`
    : "";

  // Prepare dev script content if needed
  const devScriptContent = hasDevScript
    ? `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \$(date) ==="
${devScript}
`
    : "";

  // Create a single combined command that starts both windows in parallel
  const combinedCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}

# Write maintenance script if provided
${
  hasMaintenanceScript
    ? `cat > ${ids.maintenance.scriptPath} <<'MAINTENANCE_SCRIPT_EOF'
${maintenanceScriptContent}
MAINTENANCE_SCRIPT_EOF
chmod +x ${ids.maintenance.scriptPath}`
    : ""
}

# Write dev script if provided
${
  hasDevScript
    ? `cat > ${ids.dev.scriptPath} <<'DEV_SCRIPT_EOF'
${devScriptContent}
DEV_SCRIPT_EOF
chmod +x ${ids.dev.scriptPath}`
    : ""
}

# Wait for tmux session to be ready
${waitForTmuxSession}

# Start maintenance window if script is provided
${
  hasMaintenanceScript
    ? `tmux new-window -t cmux: -n ${ids.maintenance.windowName} -d
tmux send-keys -t cmux:${ids.maintenance.windowName} "zsh ${ids.maintenance.scriptPath}; exec zsh" C-m
echo "[MAINTENANCE] Window started"`
    : ""
}

# Start dev window if script is provided
${
  hasDevScript
    ? `tmux new-window -t cmux: -n ${ids.dev.windowName} -d
tmux send-keys -t cmux:${ids.dev.windowName} "zsh ${ids.dev.scriptPath}" C-m
echo "[DEV] Window started"`
    : ""
}

# Give windows time to start
sleep 2

# Verify windows are running
${
  hasMaintenanceScript
    ? `if tmux list-windows -t cmux | grep -q "${ids.maintenance.windowName}"; then
  echo "[MAINTENANCE] Window is running"
else
  echo "[MAINTENANCE] Window may have exited (normal if script completed quickly)"
fi`
    : ""
}

${
  hasDevScript
    ? `if tmux list-windows -t cmux | grep -q "${ids.dev.windowName}"; then
  echo "[DEV] Window is running"
else
  echo "[DEV] WARNING: Window not found"
fi`
    : ""
}

echo "[STARTUP] Both windows have been started"
`;

  let maintenanceError: string | null = null;
  let devError: string | null = null;

  try {
    const result = await instance.exec(`zsh -lc ${singleQuote(combinedCommand)}`);

    if (result.exit_code !== 0) {
      const stderr = result.stderr?.trim() || "";
      const stdout = result.stdout?.trim() || "";
      const messageParts = [
        `Script startup finished with exit code ${result.exit_code}`,
        stderr ? `stderr: ${stderr}` : null,
        stdout ? `stdout: ${stdout}` : null,
      ].filter((part): part is string => part !== null);

      // Since we don't know which script failed during startup, we'll report it as a general error
      // but still return success if windows were created
      if (stdout && stdout.includes("[STARTUP] Both windows have been started")) {
        console.log(`[SCRIPT STARTUP]\n${result.stdout || ""}`);
      } else {
        maintenanceError = messageParts.join(" | ");
      }
    } else {
      console.log(`[SCRIPT STARTUP]\n${result.stdout || ""}`);
    }
  } catch (error) {
    maintenanceError = `Script startup execution failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  return {
    maintenanceError,
    devError,
  };
}
