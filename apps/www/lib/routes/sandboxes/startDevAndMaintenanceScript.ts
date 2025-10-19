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

  // Build a single exec command that spawns both scripts without blocking
  const hasMaintenanceScript = maintenanceScript && maintenanceScript.trim().length > 0;
  const hasDevScript = devScript && devScript.trim().length > 0;

  if (hasMaintenanceScript && hasDevScript) {
    // Both scripts: run maintenance first, then dev after maintenance completes
    const maintenanceRunId = `maintenance_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const maintenanceExitCodePath = `${ids.maintenance.scriptPath}.${maintenanceRunId}.exit-code`;

    const maintenanceScriptContent = `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \$(date) ==="
${maintenanceScript}
echo "=== Maintenance Script Completed at \$(date) ==="
`;

    const devScriptContent = `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \$(date) ==="
${devScript}
`;

    // Combined command that:
    // 1. Creates both script files
    // 2. Spawns maintenance in background tmux window with exit code tracking
    // 3. Spawns a watcher script that waits for maintenance to complete, then starts dev
    const combinedCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}

# Create maintenance script
cat > ${ids.maintenance.scriptPath} <<'MAINTENANCE_SCRIPT_EOF'
${maintenanceScriptContent}
MAINTENANCE_SCRIPT_EOF
chmod +x ${ids.maintenance.scriptPath}

# Create dev script
cat > ${ids.dev.scriptPath} <<'DEV_SCRIPT_EOF'
${devScriptContent}
DEV_SCRIPT_EOF
chmod +x ${ids.dev.scriptPath}

# Remove any old exit code file
rm -f ${maintenanceExitCodePath}

${waitForTmuxSession}

# Start maintenance script in its own window with exit code tracking
tmux new-window -t cmux: -n ${ids.maintenance.windowName} -d "zsh -c '
  zsh \\"${ids.maintenance.scriptPath}\\"
  EXIT_CODE=\\$?
  echo \\"\\$EXIT_CODE\\" > \\"${maintenanceExitCodePath}\\"
  if [ \\"\\$EXIT_CODE\\" -ne 0 ]; then
    echo \\"[MAINTENANCE] Script exited with code \\$EXIT_CODE\\" >&2
  else
    echo \\"[MAINTENANCE] Script completed successfully\\"
  fi
  exec zsh
'"

# Start a background process that waits for maintenance to finish, then starts dev
(
  # Wait for maintenance exit code file
  TIMEOUT=3600  # 1 hour timeout
  ELAPSED=0
  while [ ! -f ${maintenanceExitCodePath} ] && [ \\$ELAPSED -lt \\$TIMEOUT ]; do
    sleep 1
    ELAPSED=\\$((ELAPSED + 1))
  done

  if [ ! -f ${maintenanceExitCodePath} ]; then
    echo "[WATCHER] Maintenance script timed out after \\$TIMEOUT seconds" >&2
  else
    MAINTENANCE_EXIT_CODE=\\$(cat ${maintenanceExitCodePath} 2>/dev/null || echo 1)
    echo "[WATCHER] Maintenance completed with exit code \\$MAINTENANCE_EXIT_CODE"
  fi

  # Always start dev script, regardless of maintenance exit code
  # This ensures dev script runs even if maintenance fails or times out
  if tmux has-session -t cmux 2>/dev/null; then
    tmux new-window -t cmux: -n ${ids.dev.windowName} -d
    tmux send-keys -t cmux:${ids.dev.windowName} "zsh ${ids.dev.scriptPath}" C-m
    echo "[WATCHER] Dev script started"
  else
    echo "[WATCHER] ERROR: cmux session not found, cannot start dev script" >&2
  fi
) >/dev/null 2>&1 </dev/null &

sleep 2
if tmux list-windows -t cmux | grep -q "${ids.maintenance.windowName}"; then
  echo "[SETUP] Maintenance window is running"
else
  echo "[SETUP] WARNING: Maintenance window not found (may have completed very quickly)" >&2
fi
echo "[SETUP] Watcher process started to launch dev script after maintenance completes"
`;

    try {
      const result = await instance.exec(
        `zsh -lc ${singleQuote(combinedCommand)}`,
      );

      if (result.exit_code !== 0) {
        const stderr = result.stderr?.trim() || "";
        const stdout = result.stdout?.trim() || "";
        const messageParts = [
          `Script setup failed with exit code ${result.exit_code}`,
          stderr ? `stderr: ${stderr}` : null,
          stdout ? `stdout: ${stdout}` : null,
        ].filter((part): part is string => part !== null);
        const setupError = messageParts.join(" | ");
        return {
          maintenanceError: setupError,
          devError: setupError,
        };
      } else {
        console.log(`[SCRIPT SETUP]\n${result.stdout || ""}`);
      }
    } catch (error) {
      const errorMessage = `Script setup failed: ${error instanceof Error ? error.message : String(error)}`;
      return {
        maintenanceError: errorMessage,
        devError: errorMessage,
      };
    }

    // Success: both scripts are now running/scheduled
    return {
      maintenanceError: null,
      devError: null,
    };
  } else if (hasMaintenanceScript) {
    // Only maintenance script
    const maintenanceScriptContent = `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \$(date) ==="
${maintenanceScript}
echo "=== Maintenance Script Completed at \$(date) ==="
`;

    const maintenanceCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}
cat > ${ids.maintenance.scriptPath} <<'SCRIPT_EOF'
${maintenanceScriptContent}
SCRIPT_EOF
chmod +x ${ids.maintenance.scriptPath}
${waitForTmuxSession}
tmux new-window -t cmux: -n ${ids.maintenance.windowName} -d "zsh -c '
  zsh \\"${ids.maintenance.scriptPath}\\"
  EXIT_CODE=\\$?
  if [ \\"\\$EXIT_CODE\\" -ne 0 ]; then
    echo \\"[MAINTENANCE] Script exited with code \\$EXIT_CODE\\" >&2
  else
    echo \\"[MAINTENANCE] Script completed successfully\\"
  fi
  exec zsh
'"
sleep 2
if tmux list-windows -t cmux | grep -q "${ids.maintenance.windowName}"; then
  echo "[MAINTENANCE] Window is running"
else
  echo "[MAINTENANCE] WARNING: Window not found (may have completed very quickly)" >&2
fi
`;

    try {
      const result = await instance.exec(
        `zsh -lc ${singleQuote(maintenanceCommand)}`,
      );

      if (result.exit_code !== 0) {
        const stderr = result.stderr?.trim() || "";
        const stdout = result.stdout?.trim() || "";
        const messageParts = [
          `Maintenance script setup failed with exit code ${result.exit_code}`,
          stderr ? `stderr: ${stderr}` : null,
          stdout ? `stdout: ${stdout}` : null,
        ].filter((part): part is string => part !== null);
        return {
          maintenanceError: messageParts.join(" | "),
          devError: null,
        };
      } else {
        console.log(`[MAINTENANCE SCRIPT SETUP]\n${result.stdout || ""}`);
      }
    } catch (error) {
      return {
        maintenanceError: `Maintenance script setup failed: ${error instanceof Error ? error.message : String(error)}`,
        devError: null,
      };
    }

    return {
      maintenanceError: null,
      devError: null,
    };
  } else if (hasDevScript) {
    // Only dev script
    const devScriptContent = `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \$(date) ==="
${devScript}
`;

    const devCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}
cat > ${ids.dev.scriptPath} <<'SCRIPT_EOF'
${devScriptContent}
SCRIPT_EOF
chmod +x ${ids.dev.scriptPath}
${waitForTmuxSession}
tmux new-window -t cmux: -n ${ids.dev.windowName} -d
tmux send-keys -t cmux:${ids.dev.windowName} "zsh ${ids.dev.scriptPath}" C-m
sleep 2
if tmux list-windows -t cmux | grep -q "${ids.dev.windowName}"; then
  echo "[DEV] Window is running"
else
  echo "[DEV] ERROR: Window not found" >&2
  exit 1
fi
`;

    try {
      const result = await instance.exec(`zsh -lc ${singleQuote(devCommand)}`);

      if (result.exit_code !== 0) {
        const stderr = result.stderr?.trim() || "";
        const stdout = result.stdout?.trim() || "";
        const messageParts = [
          `Failed to start dev script with exit code ${result.exit_code}`,
          stderr ? `stderr: ${stderr}` : null,
          stdout ? `stdout: ${stdout}` : null,
        ].filter((part): part is string => part !== null);
        return {
          maintenanceError: null,
          devError: messageParts.join(" | "),
        };
      } else {
        console.log(`[DEV SCRIPT SETUP]\n${result.stdout || ""}`);
      }
    } catch (error) {
      return {
        maintenanceError: null,
        devError: `Dev script setup failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    return {
      maintenanceError: null,
      devError: null,
    };
  }

  // Should never reach here due to the check at the beginning
  return {
    maintenanceError: null,
    devError: null,
  };
}
