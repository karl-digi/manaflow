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

  const hasMaintenanceScript = Boolean(
    maintenanceScript && maintenanceScript.trim().length > 0,
  );
  const hasDevScript = Boolean(devScript && devScript.trim().length > 0);

  const maintenanceRunId = hasMaintenanceScript
    ? `maintenance_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 10)}`
    : null;
  const maintenanceExitCodePath = maintenanceRunId
    ? `${ids.maintenance.scriptPath}.${maintenanceRunId}.exit-code`
    : null;
  const maintenanceSignalName = maintenanceRunId
    ? `cmux_maintenance_${maintenanceRunId}_done`
    : null;
  const devLauncherPath = maintenanceRunId
    ? `${ids.dev.scriptPath}.${maintenanceRunId}.launcher.sh`
    : null;

  if (hasMaintenanceScript) {
    if (!maintenanceExitCodePath || !maintenanceSignalName) {
      throw new Error("Missing maintenance identifiers");
    }
    const maintenanceScriptContent = `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \\$(date) ==="
trap 'EXIT_CODE=$?; echo "${'${'}EXIT_CODE}" > "${maintenanceExitCodePath}"; tmux wait-for -S "${maintenanceSignalName}" || true; echo "=== Maintenance Script Completed at \\$(date) with exit code \\$EXIT_CODE ==="' EXIT

${maintenanceScript}
`;

    const commandParts: string[] = [
      "set -eu",
      `mkdir -p ${CMUX_RUNTIME_DIR}`,
      `cat > ${ids.maintenance.scriptPath} <<'SCRIPT_EOF'`,
      maintenanceScriptContent,
      "SCRIPT_EOF",
      `chmod +x ${ids.maintenance.scriptPath}`,
      `rm -f ${maintenanceExitCodePath}`,
    ];

    if (hasDevScript && devLauncherPath) {
      const devScriptContent = `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \\$(date) ==="
${devScript}
`;

      const devLauncherContent = `#!/bin/zsh
set -eu
EXIT_CODE_PATH="${maintenanceExitCodePath}"
LAUNCHER_SELF="${devLauncherPath}"
echo "[DEV LAUNCHER] Waiting for maintenance completion signal"
tmux wait-for "${maintenanceSignalName}"
DEV_EXIT_CODE=0
if [ -f "$EXIT_CODE_PATH" ]; then
  DEV_EXIT_CODE=$(cat "$EXIT_CODE_PATH" || echo 0)
fi
echo "[DEV LAUNCHER] Maintenance exited with code $DEV_EXIT_CODE"
tmux kill-window -t cmux:${ids.dev.windowName} 2>/dev/null || true
tmux new-window -t cmux: -n ${ids.dev.windowName} -d
tmux send-keys -t cmux:${ids.dev.windowName} "zsh ${ids.dev.scriptPath}" C-m
rm -f "$LAUNCHER_SELF" 2>/dev/null || true
`;

      commandParts.push(
        `cat > ${ids.dev.scriptPath} <<'DEV_EOF'`,
        devScriptContent,
        "DEV_EOF",
        `chmod +x ${ids.dev.scriptPath}`,
        `rm -f ${devLauncherPath}`,
        `cat > ${devLauncherPath} <<'LAUNCHER_EOF'`,
        devLauncherContent,
        "LAUNCHER_EOF",
        `chmod +x ${devLauncherPath}`,
      );
    }

    commandParts.push(
      waitForTmuxSession,
      `tmux kill-window -t cmux:${ids.maintenance.windowName} 2>/dev/null || true`,
    );

    if (hasDevScript && devLauncherPath) {
      commandParts.push(
        `tmux kill-window -t cmux:${ids.dev.windowName} 2>/dev/null || true`,
        `tmux run-shell -b ${singleQuote(`zsh ${devLauncherPath}`)}`,
      );
    }

    commandParts.push(
      `tmux new-window -t cmux: -n ${ids.maintenance.windowName} -d ${singleQuote(
        `zsh ${ids.maintenance.scriptPath}`,
      )}`,
      "sleep 1",
      `if tmux list-windows -t cmux | grep -q "${ids.maintenance.windowName}"; then`,
      "  echo \"[MAINTENANCE] Window is running\"",
      "else",
      "  echo \"[MAINTENANCE] Window may have exited early\" >&2",
      "fi",
    );

    const maintenanceCommand = commandParts.join("\n");

    try {
      const result = await instance.exec(
        `zsh -lc ${singleQuote(maintenanceCommand)}`,
      );

      if (result.exit_code !== 0) {
        const stderr = result.stderr?.trim() || "";
        const stdout = result.stdout?.trim() || "";
        const messageParts = [
          `Maintenance script preparation exited with code ${result.exit_code}`,
          stderr ? `stderr: ${stderr}` : null,
          stdout ? `stdout: ${stdout}` : null,
        ].filter((part): part is string => part !== null);
        maintenanceError = messageParts.join(" | ");
      } else {
        console.log(`[MAINTENANCE SCRIPT LAUNCH]\n${result.stdout || ""}`);
      }
    } catch (error) {
      maintenanceError = `Maintenance script launch failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    if (!maintenanceError && maintenanceExitCodePath) {
      const waitIterations = 18; // ~9 seconds @ 0.5s interval
      const waitCommand = `set -eu
for i in $(seq 1 ${waitIterations}); do
  if [ -f ${maintenanceExitCodePath} ]; then
    cat ${maintenanceExitCodePath}
    exit 0
  fi
  sleep 0.5
done
exit 99
`;

      try {
        const waitResult = await instance.exec(
          `zsh -lc ${singleQuote(waitCommand)}`,
        );

        if (waitResult.exit_code === 0) {
          const exitCodeRaw = waitResult.stdout?.trim();
          const parsedExitCode = exitCodeRaw ? Number(exitCodeRaw) : 0;
          if (!Number.isNaN(parsedExitCode) && parsedExitCode !== 0) {
            maintenanceError = `Maintenance script exited with code ${parsedExitCode}`;
          }
        } else if (waitResult.exit_code === 99) {
          console.log(
            "[MAINTENANCE SCRIPT LAUNCH] Maintenance still running past initial wait window",
          );
        } else {
          const stderr = waitResult.stderr?.trim() || "";
          maintenanceError = `Failed to check maintenance completion (exit ${waitResult.exit_code}${
            stderr ? `, stderr: ${stderr}` : ""
          })`;
        }
      } catch (error) {
        maintenanceError = `Maintenance completion check failed: ${error instanceof Error ? error.message : String(error)}`;
      }

      if (maintenanceError && maintenanceExitCodePath) {
        maintenanceError +=
          " | Maintenance still scheduled remotely; check tmux maintenance window for details.";
      }
    }
  }

  if (hasDevScript && !hasMaintenanceScript) {
    const devScriptContent = `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \\$(date) ==="
${devScript}
`;

    const devCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}
cat > ${ids.dev.scriptPath} <<'SCRIPT_EOF'
${devScriptContent}
SCRIPT_EOF
chmod +x ${ids.dev.scriptPath}
${waitForTmuxSession}
tmux kill-window -t cmux:${ids.dev.windowName} 2>/dev/null || true
tmux new-window -t cmux: -n ${ids.dev.windowName} -d
tmux send-keys -t cmux:${ids.dev.windowName} "zsh ${ids.dev.scriptPath}" C-m
sleep 1
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
        devError = messageParts.join(" | ");
      } else {
        console.log(`[DEV SCRIPT LAUNCH]\n${result.stdout || ""}`);
      }
    } catch (error) {
      devError = `Dev script execution failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return {
    maintenanceError,
    devError,
  };
}
