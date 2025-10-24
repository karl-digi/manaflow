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

  let maintenanceError: string | null = null;
  let devError: string | null = null;

  // Build the combined script content that starts both windows
  const scriptParts: string[] = [];

  scriptParts.push(`set -eu`);
  scriptParts.push(`mkdir -p ${CMUX_RUNTIME_DIR}`);

  // Prepare maintenance script if provided
  if (maintenanceScript && maintenanceScript.trim().length > 0) {
    const maintenanceScriptContent = `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \$(date) ==="
${maintenanceScript}
echo "=== Maintenance Script Completed at \$(date) ==="
`;

    scriptParts.push(`cat > ${ids.maintenance.scriptPath} <<'SCRIPT_EOF'
${maintenanceScriptContent}
SCRIPT_EOF`);
    scriptParts.push(`chmod +x ${ids.maintenance.scriptPath}`);
  }

  // Prepare dev script if provided
  if (devScript && devScript.trim().length > 0) {
    const devScriptContent = `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \$(date) ==="
${devScript}
`;

    scriptParts.push(`cat > ${ids.dev.scriptPath} <<'SCRIPT_EOF'
${devScriptContent}
SCRIPT_EOF`);
    scriptParts.push(`chmod +x ${ids.dev.scriptPath}`);
  }

  // Wait for tmux session
  scriptParts.push(waitForTmuxSession);

  // Start both windows immediately without waiting
  if (maintenanceScript && maintenanceScript.trim().length > 0) {
    scriptParts.push(`tmux new-window -t cmux: -n ${ids.maintenance.windowName} -d`);
    scriptParts.push(`tmux send-keys -t cmux:${ids.maintenance.windowName} "zsh ${ids.maintenance.scriptPath}; exec zsh" C-m`);
  }

  if (devScript && devScript.trim().length > 0) {
    scriptParts.push(`tmux new-window -t cmux: -n ${ids.dev.windowName} -d`);
    scriptParts.push(`tmux send-keys -t cmux:${ids.dev.windowName} "zsh ${ids.dev.scriptPath}" C-m`);
  }

  // Verify windows were created
  scriptParts.push(`sleep 2`);

  if (maintenanceScript && maintenanceScript.trim().length > 0) {
    scriptParts.push(`if tmux list-windows -t cmux | grep -q "${ids.maintenance.windowName}"; then
  echo "[MAINTENANCE] Window is running"
else
  echo "[MAINTENANCE] ERROR: Window not found" >&2
  exit 1
fi`);
  }

  if (devScript && devScript.trim().length > 0) {
    scriptParts.push(`if tmux list-windows -t cmux | grep -q "${ids.dev.windowName}"; then
  echo "[DEV] Window is running"
else
  echo "[DEV] ERROR: Window not found" >&2
  exit 1
fi`);
  }

  const combinedCommand = scriptParts.join('\n');

  try {
    const result = await instance.exec(`zsh -lc ${singleQuote(combinedCommand)}`);

    if (result.exit_code !== 0) {
      const stderr = result.stderr?.trim() || "";
      const stdout = result.stdout?.trim() || "";
      const messageParts = [
        `Failed to start scripts with exit code ${result.exit_code}`,
        stderr ? `stderr: ${stderr}` : null,
        stdout ? `stdout: ${stdout}` : null,
      ].filter((part): part is string => part !== null);

      // If either script was supposed to run, set appropriate error
      if (maintenanceScript && maintenanceScript.trim().length > 0) {
        maintenanceError = messageParts.join(" | ");
      }
      if (devScript && devScript.trim().length > 0) {
        devError = messageParts.join(" | ");
      }
    } else {
      console.log(`[SCRIPT STARTUP VERIFICATION]\n${result.stdout || ""}`);
    }
  } catch (error) {
    const errorMsg = `Script execution failed: ${error instanceof Error ? error.message : String(error)}`;
    if (maintenanceScript && maintenanceScript.trim().length > 0) {
      maintenanceError = errorMsg;
    }
    if (devScript && devScript.trim().length > 0) {
      devError = errorMsg;
    }
  }

  return {
    maintenanceError,
    devError,
  };
}
