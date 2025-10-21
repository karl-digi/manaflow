import type { MorphInstance } from "./git";
import { singleQuote } from "./shell";

const WORKSPACE_ROOT = "/root/workspace";
const CMUX_RUNTIME_DIR = "/var/tmp/cmux-scripts";
const CMUX_LOG_DIR = "/var/log/cmux";
const START_SCRIPT_ERROR_LOG = `${CMUX_LOG_DIR}/start-dev-and-maintenance.log`;
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

  const trimmedMaintenanceScript = maintenanceScript?.trim() ?? "";
  const trimmedDevScript = devScript?.trim() ?? "";

  if (trimmedMaintenanceScript.length === 0 && trimmedDevScript.length === 0) {
    return {
      maintenanceError: "Both maintenance and dev scripts are empty",
      devError: null,
    };
  }

  const shouldRunMaintenance = trimmedMaintenanceScript.length > 0;
  const shouldRunDev = trimmedDevScript.length > 0;

  const scriptParts: string[] = [
    `set -u
WORKSPACE_ROOT=${WORKSPACE_ROOT}
CMUX_RUNTIME_DIR=${CMUX_RUNTIME_DIR}
CMUX_LOG_DIR=${CMUX_LOG_DIR}
ERROR_LOG_PATH=${START_SCRIPT_ERROR_LOG}
mkdir -p "$CMUX_RUNTIME_DIR"
mkdir -p "$CMUX_LOG_DIR"
if [ ! -f "$ERROR_LOG_PATH" ]; then
  touch "$ERROR_LOG_PATH"
fi
log_error() {
  local message="$1"
  echo "[ERROR] $message" | tee -a "$ERROR_LOG_PATH" >&2
}
log_info() {
  echo "[INFO] $1"
}
wait_for_tmux_session() {
  for i in {1..20}; do
    if tmux has-session -t cmux 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done

  log_error "tmux session 'cmux' not found"
  return 1
}
MAINTENANCE_EXIT_CODE=""
MAINTENANCE_ERROR=""
DEV_ERROR=""
`,
  ];

  if (shouldRunMaintenance) {
    const maintenanceRunId = `maintenance_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const maintenanceScriptPath = ids.maintenance.scriptPath;
    const maintenanceExitCodePath = `${maintenanceScriptPath}.${maintenanceRunId}.exit-code`;
    const maintenanceRunnerPath = `${maintenanceScriptPath}.${maintenanceRunId}.runner.sh`;
    const maintenanceScriptContent = `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \\$(date) ==="
${trimmedMaintenanceScript}
echo "=== Maintenance Script Completed at \\$(date) ==="
`;

    scriptParts.push(`
MAINTENANCE_SCRIPT_PATH="${maintenanceScriptPath}"
MAINTENANCE_EXIT_CODE_PATH="${maintenanceExitCodePath}"
MAINTENANCE_RUNNER_PATH="${maintenanceRunnerPath}"
rm -f "$MAINTENANCE_EXIT_CODE_PATH" "$MAINTENANCE_RUNNER_PATH"
cat > "$MAINTENANCE_SCRIPT_PATH" <<'MAINTENANCE_SCRIPT_EOF'
${maintenanceScriptContent}
MAINTENANCE_SCRIPT_EOF
chmod +x "$MAINTENANCE_SCRIPT_PATH"
cat > "$MAINTENANCE_RUNNER_PATH" <<MAINTENANCE_RUNNER_EOF
#!/bin/zsh
set -u
"$MAINTENANCE_SCRIPT_PATH"
EXIT_CODE=$?
echo "$EXIT_CODE" > "$MAINTENANCE_EXIT_CODE_PATH"
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "[MAINTENANCE] Script exited with code $EXIT_CODE" >&2
else
  echo "[MAINTENANCE] Script completed successfully"
fi
exec zsh
MAINTENANCE_RUNNER_EOF
chmod +x "$MAINTENANCE_RUNNER_PATH"
if wait_for_tmux_session; then
  log_info "[MAINTENANCE] Launching script in tmux window '${ids.maintenance.windowName}'"
  if tmux new-window -t cmux: -n ${ids.maintenance.windowName} -d "$MAINTENANCE_RUNNER_PATH"; then
    for i in {1..600}; do
      if [ -f "$MAINTENANCE_EXIT_CODE_PATH" ]; then
        break
      fi
      sleep 1
    done
    if [ -f "$MAINTENANCE_EXIT_CODE_PATH" ]; then
      MAINTENANCE_EXIT_CODE=$(cat "$MAINTENANCE_EXIT_CODE_PATH" || echo "")
      rm -f "$MAINTENANCE_EXIT_CODE_PATH" "$MAINTENANCE_RUNNER_PATH"
      if [ -z "$MAINTENANCE_EXIT_CODE" ]; then
        MAINTENANCE_ERROR="Maintenance script did not report an exit code"
        log_error "$MAINTENANCE_ERROR"
      elif [ "$MAINTENANCE_EXIT_CODE" != "0" ]; then
        MAINTENANCE_ERROR="Maintenance script exited with code $MAINTENANCE_EXIT_CODE"
        log_error "$MAINTENANCE_ERROR"
      else
        log_info "[MAINTENANCE] Wait complete with exit code 0"
      fi
    else
      MAINTENANCE_ERROR="Maintenance script exit code file not found"
      log_error "$MAINTENANCE_ERROR"
      rm -f "$MAINTENANCE_EXIT_CODE_PATH" "$MAINTENANCE_RUNNER_PATH"
    fi
  else
    MAINTENANCE_ERROR="Failed to create maintenance tmux window"
    log_error "[MAINTENANCE] $MAINTENANCE_ERROR"
    rm -f "$MAINTENANCE_RUNNER_PATH"
  fi
else
  MAINTENANCE_ERROR="tmux session 'cmux' not found"
  rm -f "$MAINTENANCE_RUNNER_PATH"
fi
`);
  }

  if (shouldRunDev) {
    const devScriptContent = `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \\$(date) ==="
${trimmedDevScript}
`;

    scriptParts.push(`
DEV_SCRIPT_PATH="${ids.dev.scriptPath}"
rm -f "$DEV_SCRIPT_PATH"
cat > "$DEV_SCRIPT_PATH" <<'DEV_SCRIPT_EOF'
${devScriptContent}
DEV_SCRIPT_EOF
chmod +x "$DEV_SCRIPT_PATH"
if wait_for_tmux_session; then
  log_info "[DEV] Opening tmux window '${ids.dev.windowName}'"
  if tmux new-window -t cmux: -n ${ids.dev.windowName} -d; then
    if tmux send-keys -t cmux:${ids.dev.windowName} "zsh \"$DEV_SCRIPT_PATH\"" C-m; then
      log_info "[DEV] Script started"
    else
      DEV_ERROR="Failed to send dev script to tmux window"
      log_error "[DEV] $DEV_ERROR"
      tmux kill-window -t cmux:${ids.dev.windowName} >/dev/null 2>&1 || true
    fi
  else
    DEV_ERROR="Failed to create dev tmux window"
    log_error "[DEV] $DEV_ERROR"
  fi
else
  DEV_ERROR="tmux session 'cmux' not found"
fi
`);
  }

  scriptParts.push(`
export MAINTENANCE_EXIT_CODE
export MAINTENANCE_ERROR
export DEV_ERROR
python3 - <<'PY'
import json
import os


def to_optional(name: str):
    value = os.environ.get(name)
    return value if value else None


def to_optional_int(name: str):
    value = os.environ.get(name)
    if not value:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


payload = {
    "maintenance": {
        "exitCode": to_optional_int("MAINTENANCE_EXIT_CODE"),
        "error": to_optional("MAINTENANCE_ERROR"),
    },
    "dev": {
        "error": to_optional("DEV_ERROR"),
    },
}


print("__CMUX_RESULT__" + json.dumps(payload) + "__CMUX_RESULT__")
PY
exit 0
`);

  const combinedScript = scriptParts.join("\n");

  let maintenanceError: string | null = null;
  let devError: string | null = null;

  try {
    const result = await instance.exec(`zsh -lc ${singleQuote(combinedScript)}`);

    const summaryMatch = result.stdout?.match(
      /__CMUX_RESULT__(?<json>{[\s\S]*})__CMUX_RESULT__/,
    );
    const summaryJson = summaryMatch?.groups?.json;

    if (summaryJson) {
      const summary = JSON.parse(summaryJson) as {
        maintenance: { exitCode: number | null; error: string | null };
        dev: { error: string | null };
      };

      if (summary.maintenance.error) {
        maintenanceError = summary.maintenance.error;
      } else if (
        typeof summary.maintenance.exitCode === "number" &&
        summary.maintenance.exitCode !== 0
      ) {
        maintenanceError = `Maintenance script exited with code ${summary.maintenance.exitCode}`;
      }

      if (summary.dev.error) {
        devError = summary.dev.error;
      }
    } else if (result.exit_code !== 0) {
      const message = `Combined script exited with code ${result.exit_code}`;
      if (shouldRunMaintenance) {
        maintenanceError = message;
      }
      if (shouldRunDev) {
        devError = message;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (shouldRunMaintenance) {
      maintenanceError = `Maintenance script execution failed: ${message}`;
    }
    if (shouldRunDev) {
      devError = `Dev script execution failed: ${message}`;
    }
    if (!shouldRunMaintenance && !shouldRunDev) {
      maintenanceError = `Maintenance script execution failed: ${message}`;
      devError = `Dev script execution failed: ${message}`;
    }
  }

  return {
    maintenanceError,
    devError,
  };
}
