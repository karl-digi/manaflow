import type { MorphInstance } from "./git";
import { singleQuote } from "./shell";

const WORKSPACE_ROOT = "/root/workspace";
const CMUX_RUNTIME_DIR = "/var/tmp/cmux-scripts";
const MAINTENANCE_WINDOW_NAME = "maintenance";
const MAINTENANCE_SCRIPT_FILENAME = "maintenance.sh";
const DEV_WINDOW_NAME = "dev";
const DEV_SCRIPT_FILENAME = "dev.sh";
const MAINTENANCE_EXIT_TIMEOUT_SECONDS = 3600;
const EXIT_CODE_POLL_INTERVAL_MS = 1000;

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

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitForExitCode = async ({
    path,
    timeoutSeconds,
    label,
  }: {
    path: string;
    timeoutSeconds: number;
    label: string;
  }): Promise<{ exitCode: number | null; error: string | null }> => {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      try {
        const result = await instance.exec(
          `zsh -lc ${singleQuote(
            `
if [ -f ${path} ]; then
  cat ${path}
  exit 0
fi
exit 1
            `.trim(),
          )}`,
        );

        if (result.exit_code === 0) {
          const rawValue = result.stdout?.trim() ?? "";
          if (rawValue.length === 0) {
            return { exitCode: 0, error: null };
          }
          const firstToken =
            rawValue
              .split(/\s+/)
              .find((token) => token.length > 0) ?? "";
          const parsed = Number.parseInt(firstToken, 10);
          if (Number.isNaN(parsed)) {
            return {
              exitCode: null,
              error: `${label} exit code not numeric: ${rawValue}`,
            };
          }
          return { exitCode: parsed, error: null };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          exitCode: null,
          error: `Failed to read ${label.toLowerCase()} exit code: ${message}`,
        };
      }

      await sleep(EXIT_CODE_POLL_INTERVAL_MS);
    }

    return {
      exitCode: null,
      error: `${label} script timed out after ${timeoutSeconds} seconds`,
    };
  };

  const waitForStatusFile = async ({
    path,
    timeoutSeconds,
    label,
  }: {
    path: string;
    timeoutSeconds: number;
    label: string;
  }): Promise<{ content: string | null; error: string | null }> => {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      try {
        const result = await instance.exec(
          `zsh -lc ${singleQuote(
            `
if [ -f ${path} ]; then
  cat ${path}
  exit 0
fi
exit 1
            `.trim(),
          )}`,
        );

        if (result.exit_code === 0) {
          return { content: result.stdout?.trim() ?? "", error: null };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: null,
          error: `Failed to read ${label.toLowerCase()}: ${message}`,
        };
      }

      await sleep(EXIT_CODE_POLL_INTERVAL_MS);
    }

    return {
      content: null,
      error: `${label} not written after ${timeoutSeconds} seconds`,
    };
  };

  const cleanupPaths = async (paths: string[]) => {
    if (paths.length === 0) {
      return;
    }

    try {
      await instance.exec(
        `zsh -lc ${singleQuote(paths.map((target) => `rm -f ${target}`).join("; "))}`,
      );
    } catch (error) {
      console.warn(
        `[sandboxes.start] Failed to clean up paths ${paths.join(", ")}:`,
        error,
      );
    }
  };

  if (hasMaintenanceScript && hasDevScript) {
    const maintenanceRunId = `maintenance_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const maintenanceExitCodePath = `${ids.maintenance.scriptPath}.${maintenanceRunId}.exit-code`;
    const devStatusPath = `${ids.dev.scriptPath}.${maintenanceRunId}.status`;
    const watcherScriptPath = `${ids.dev.scriptPath}.${maintenanceRunId}.watcher.sh`;
    const watcherLogPath = `${ids.dev.scriptPath}.${maintenanceRunId}.watcher.log`;

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

    const watcherScriptContent = `#!/bin/zsh
set -eu

EXIT_CODE_PATH="${maintenanceExitCodePath}"
STATUS_PATH="${devStatusPath}"
DEV_WINDOW="${ids.dev.windowName}"
DEV_SCRIPT="${ids.dev.scriptPath}"
LOG_PATH="${watcherLogPath}"
TIMEOUT=${MAINTENANCE_EXIT_TIMEOUT_SECONDS}
ELAPSED=0

log() {
  echo "[DEV WATCHER] $1" >> "$LOG_PATH"
}

: > "$LOG_PATH"
log "Watcher started"

while [ ! -f "$EXIT_CODE_PATH" ] && [ $ELAPSED -lt $TIMEOUT ]; do
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

if [ ! -f "$EXIT_CODE_PATH" ]; then
  log "Maintenance exit code file missing after $TIMEOUT seconds"
else
  MAINT_EXIT_CODE=$(cat "$EXIT_CODE_PATH" 2>/dev/null || echo 1)
  log "Maintenance exit code: $MAINT_EXIT_CODE"
fi

if tmux has-session -t cmux 2>/dev/null; then
  tmux new-window -t cmux: -n "$DEV_WINDOW" -d
  tmux send-keys -t cmux:"$DEV_WINDOW" "zsh $DEV_SCRIPT" C-m
  sleep 2
  if tmux list-windows -t cmux | grep -q "$DEV_WINDOW"; then
    log "Dev window running"
    echo "ok" > "$STATUS_PATH"
    exit 0
  fi
  log "Dev window missing after start"
  echo "error: dev window missing" > "$STATUS_PATH"
  exit 1
fi

log "tmux session missing"
echo "error: tmux session missing" > "$STATUS_PATH"
exit 1
`;

    const maintenanceSetupCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}

cat > ${ids.maintenance.scriptPath} <<'MAINTENANCE_SCRIPT_EOF'
${maintenanceScriptContent}
MAINTENANCE_SCRIPT_EOF
chmod +x ${ids.maintenance.scriptPath}

cat > ${ids.dev.scriptPath} <<'DEV_SCRIPT_EOF'
${devScriptContent}
DEV_SCRIPT_EOF
chmod +x ${ids.dev.scriptPath}

rm -f ${maintenanceExitCodePath} ${devStatusPath} ${watcherScriptPath}
${waitForTmuxSession}

tmux new-window -t cmux: -n ${ids.maintenance.windowName} -d "zsh -c '
  zsh "${ids.maintenance.scriptPath}"
  EXIT_CODE=\$?
  echo "\$EXIT_CODE" > "${maintenanceExitCodePath}"
  if [ "\$EXIT_CODE" -ne 0 ]; then
    echo "[MAINTENANCE] Script exited with code \$EXIT_CODE" >&2
  else
    echo "[MAINTENANCE] Script completed successfully"
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
      const setupResult = await instance.exec(
        `zsh -lc ${singleQuote(maintenanceSetupCommand)}`,
      );

      if (setupResult.exit_code !== 0) {
        const stderr = setupResult.stderr?.trim() || "";
        const stdout = setupResult.stdout?.trim() || "";
        const messageParts = [
          `Failed to start maintenance script (exit ${setupResult.exit_code})`,
          stderr ? `stderr: ${stderr}` : null,
          stdout ? `stdout: ${stdout}` : null,
        ].filter((part): part is string => part !== null);
        const setupError = messageParts.join(" | ");
        return {
          maintenanceError: setupError,
          devError: setupError,
        };
      }

      if (setupResult.stdout) {
        console.log(`[MAINTENANCE SCRIPT SETUP]
${setupResult.stdout}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        maintenanceError: `Failed to start maintenance script: ${message}`,
        devError: `Failed to start maintenance script: ${message}`,
      };
    }

    const watcherSetupCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}
cat > ${watcherScriptPath} <<'DEV_WATCHER_EOF'
${watcherScriptContent}
DEV_WATCHER_EOF
chmod +x ${watcherScriptPath}
rm -f ${devStatusPath} ${watcherLogPath}
touch ${watcherLogPath}
nohup zsh ${watcherScriptPath} >> ${watcherLogPath} 2>&1 &
WATCHER_PID=$!
sleep 1
if ps -p $WATCHER_PID >/dev/null 2>&1; then
  echo "[WATCHER] Dev watcher running (pid $WATCHER_PID)"
else
  echo "[WATCHER] WARNING: Unable to confirm watcher startup" >&2
fi
`;

    try {
      const watcherResult = await instance.exec(
        `zsh -lc ${singleQuote(watcherSetupCommand)}`,
      );

      if (watcherResult.exit_code !== 0) {
        const stderr = watcherResult.stderr?.trim() || "";
        const stdout = watcherResult.stdout?.trim() || "";
        const messageParts = [
          `Failed to start dev watcher (exit ${watcherResult.exit_code})`,
          stderr ? `stderr: ${stderr}` : null,
          stdout ? `stdout: ${stdout}` : null,
        ].filter((part): part is string => part !== null);
        const watcherError = messageParts.join(" | ");
        return {
          maintenanceError: watcherError,
          devError: watcherError,
        };
      }

      if (watcherResult.stdout) {
        console.log(`[DEV WATCHER SETUP]
${watcherResult.stdout}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        maintenanceError: `Failed to start dev watcher: ${message}`,
        devError: `Failed to start dev watcher: ${message}`,
      };
    }

    const { exitCode: maintenanceExitCode, error: maintenanceExitError } =
      await waitForExitCode({
        path: maintenanceExitCodePath,
        timeoutSeconds: MAINTENANCE_EXIT_TIMEOUT_SECONDS,
        label: "Maintenance",
      });

    let maintenanceError: string | null = null;
    if (maintenanceExitError) {
      maintenanceError = maintenanceExitError;
    } else if (maintenanceExitCode !== null && maintenanceExitCode !== 0) {
      maintenanceError = `Maintenance script finished with exit code ${maintenanceExitCode}`;
    }

    const { content: devStatus, error: devStatusError } = await waitForStatusFile({
      path: devStatusPath,
      timeoutSeconds: MAINTENANCE_EXIT_TIMEOUT_SECONDS + 120,
      label: "Dev watcher status",
    });

    let devError: string | null = null;
    if (devStatusError) {
      devError = devStatusError;
    } else if (devStatus) {
      if (!devStatus.toLowerCase().startsWith("ok")) {
        devError = `Dev watcher reported error: ${devStatus}`;
      }
    } else {
      devError = "Dev watcher status was empty";
    }

    await cleanupPaths([
      maintenanceExitCodePath,
      devStatusPath,
      watcherScriptPath,
    ]);

    return {
      maintenanceError,
      devError,
    };
  } else if (hasMaintenanceScript) {
    const maintenanceExitCodePath = `${ids.maintenance.scriptPath}.single.exit-code`;

    const maintenanceScriptContent = `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \$(date) ==="
${maintenanceScript}
echo "=== Maintenance Script Completed at \$(date) ==="
`;

    const maintenanceSetupCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}
cat > ${ids.maintenance.scriptPath} <<'SCRIPT_EOF'
${maintenanceScriptContent}
SCRIPT_EOF
chmod +x ${ids.maintenance.scriptPath}
rm -f ${maintenanceExitCodePath}
${waitForTmuxSession}
tmux new-window -t cmux: -n ${ids.maintenance.windowName} -d "zsh -c '
  zsh "${ids.maintenance.scriptPath}"
  EXIT_CODE=\$?
  echo "\$EXIT_CODE" > "${maintenanceExitCodePath}"
  if [ "\$EXIT_CODE" -ne 0 ]; then
    echo "[MAINTENANCE] Script exited with code \$EXIT_CODE" >&2
  else
    echo "[MAINTENANCE] Script completed successfully"
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
      const setupResult = await instance.exec(
        `zsh -lc ${singleQuote(maintenanceSetupCommand)}`,
      );

      if (setupResult.exit_code !== 0) {
        const stderr = setupResult.stderr?.trim() || "";
        const stdout = setupResult.stdout?.trim() || "";
        const messageParts = [
          `Failed to start maintenance script (exit ${setupResult.exit_code})`,
          stderr ? `stderr: ${stderr}` : null,
          stdout ? `stdout: ${stdout}` : null,
        ].filter((part): part is string => part !== null);
        return {
          maintenanceError: messageParts.join(" | "),
          devError: null,
        };
      }

      if (setupResult.stdout) {
        console.log(`[MAINTENANCE SCRIPT SETUP]
${setupResult.stdout}`);
      }
    } catch (error) {
      return {
        maintenanceError: `Failed to start maintenance script: ${error instanceof Error ? error.message : String(error)}`,
        devError: null,
      };
    }

    const { exitCode: maintenanceExitCode, error: maintenanceExitError } =
      await waitForExitCode({
        path: maintenanceExitCodePath,
        timeoutSeconds: MAINTENANCE_EXIT_TIMEOUT_SECONDS,
        label: "Maintenance",
      });

    let maintenanceError: string | null = null;
    if (maintenanceExitError) {
      maintenanceError = maintenanceExitError;
    } else if (maintenanceExitCode !== null && maintenanceExitCode !== 0) {
      maintenanceError = `Maintenance script finished with exit code ${maintenanceExitCode}`;
    }

    await cleanupPaths([maintenanceExitCodePath]);

    return {
      maintenanceError,
      devError: null,
    };
  } else if (hasDevScript) {
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
          `Failed to start dev script (exit ${result.exit_code})`,
          stderr ? `stderr: ${stderr}` : null,
          stdout ? `stdout: ${stdout}` : null,
        ].filter((part): part is string => part !== null);
        return {
          maintenanceError: null,
          devError: messageParts.join(" | "),
        };
      }

      if (result.stdout) {
        console.log(`[DEV SCRIPT SETUP]
${result.stdout}`);
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

  return {
    maintenanceError: null,
    devError: null,
  };
}
