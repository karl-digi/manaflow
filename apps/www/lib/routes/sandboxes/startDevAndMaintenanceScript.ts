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

  // Create a single script that starts both windows immediately
  const hasMaintenanceScript = maintenanceScript && maintenanceScript.trim().length > 0;
  const hasDevScript = devScript && devScript.trim().length > 0;

  const maintenanceRunId = `maintenance_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const maintenanceExitCodePath = `${ids.maintenance.scriptPath}.${maintenanceRunId}.exit-code`;

  // Build the maintenance script content
  const maintenanceScriptContent = hasMaintenanceScript
    ? `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \$(date) ==="
${maintenanceScript}
echo "=== Maintenance Script Completed at \$(date) ==="
`
    : "";

  const maintenanceWindowCommand = hasMaintenanceScript
    ? `zsh "${ids.maintenance.scriptPath}"
EXIT_CODE=$?
echo "$EXIT_CODE" > "${maintenanceExitCodePath}"
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "[MAINTENANCE] Script exited with code $EXIT_CODE" >&2
else
  echo "[MAINTENANCE] Script completed successfully"
fi
exec zsh`
    : "";

  // Build the dev script content
  const devScriptContent = hasDevScript
    ? `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \$(date) ==="
${devScript}
`
    : "";

  // Create a combined command that starts both windows at once
  const combinedCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}
${hasMaintenanceScript ? `
cat > ${ids.maintenance.scriptPath} <<'SCRIPT_EOF'
${maintenanceScriptContent}
SCRIPT_EOF
chmod +x ${ids.maintenance.scriptPath}
rm -f ${maintenanceExitCodePath}
` : ""}
${hasDevScript ? `
cat > ${ids.dev.scriptPath} <<'SCRIPT_EOF'
${devScriptContent}
SCRIPT_EOF
chmod +x ${ids.dev.scriptPath}
` : ""}
${waitForTmuxSession}
${hasMaintenanceScript ? `
# Start maintenance window
tmux new-window -t cmux: -n ${ids.maintenance.windowName} -d ${singleQuote(maintenanceWindowCommand)}
echo "[MAINTENANCE] Window started"
` : ""}
${hasDevScript ? `
# Start dev window
tmux new-window -t cmux: -n ${ids.dev.windowName} -d
tmux send-keys -t cmux:${ids.dev.windowName} "zsh ${ids.dev.scriptPath}" C-m
echo "[DEV] Window started"
` : ""}
sleep 2
${hasMaintenanceScript ? `
if tmux list-windows -t cmux | grep -q "${ids.maintenance.windowName}"; then
  echo "[MAINTENANCE] Window is running"
else
  echo "[MAINTENANCE] Window may have exited (normal if script completed)"
fi
` : ""}
${hasDevScript ? `
if tmux list-windows -t cmux | grep -q "${ids.dev.windowName}"; then
  echo "[DEV] Window is running"
else
  echo "[DEV] ERROR: Window not found" >&2
  exit 1
fi
` : ""}
echo "[COMBINED] Both windows started successfully"
`;

  let maintenanceError: string | null = null;
  let devError: string | null = null;

  try {
    const result = await instance.exec(`zsh -lc ${singleQuote(combinedCommand)}`);

    if (result.exit_code !== 0) {
      const stderr = result.stderr?.trim() || "";
      const stdout = result.stdout?.trim() || "";
      const messageParts = [
        `Combined script execution failed with exit code ${result.exit_code}`,
        stderr ? `stderr: ${stderr}` : null,
        stdout ? `stdout: ${stdout}` : null,
      ].filter((part): part is string => part !== null);

      // If dev window failed to start, record it as dev error
      // Otherwise treat as maintenance error for backwards compatibility
      if (stdout?.includes("[DEV] ERROR") || stderr?.includes("[DEV]")) {
        devError = messageParts.join(" | ");
      } else {
        maintenanceError = messageParts.join(" | ");
      }
    } else {
      console.log(`[COMBINED SCRIPT VERIFICATION]\n${result.stdout || ""}`);
    }
  } catch (error) {
    maintenanceError = `Combined script execution failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  return {
    maintenanceError,
    devError,
  };
}
