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

  // Create a single script that will be executed via instance.exec
  // This script runs in the background using nohup to avoid Vercel function timeouts
  const runScriptsContent = `#!/bin/zsh
set -eux

# Log file for all errors
LOG_FILE="/var/log/cmux/startup.log"
mkdir -p $(dirname "$LOG_FILE")

# Function to log messages
log() {
  echo "[$(date -Iseconds)] $1" | tee -a "$LOG_FILE"
}

log "=== Starting maintenance and dev scripts orchestration ==="

# Ensure tmux session exists
if ! tmux has-session -t cmux 2>/dev/null; then
  log "Creating tmux session 'cmux'"
  tmux new-session -d -s cmux
fi

# Create maintenance script
mkdir -p ${CMUX_RUNTIME_DIR}
cat > ${ids.maintenance.scriptPath} <<'MAINTENANCE_SCRIPT_EOF'
#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \$(date) ==="
${maintenanceScript || "echo 'No maintenance script provided'"}
echo "=== Maintenance Script Completed at \$(date) ==="
MAINTENANCE_SCRIPT_EOF
chmod +x ${ids.maintenance.scriptPath}

# Create dev script
cat > ${ids.dev.scriptPath} <<'DEV_SCRIPT_EOF'
#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \$(date) ==="
${devScript || "echo 'No dev script provided'"}
DEV_SCRIPT_EOF
chmod +x ${ids.dev.scriptPath}

# Create maintenance tmux window
log "Creating tmux window 'maintenance'"
tmux new-window -t cmux: -n maintenance

# Run maintenance script and capture exit code
MAINTENANCE_EXIT_FILE="/tmp/maintenance-exit-code"
rm -f "$MAINTENANCE_EXIT_FILE"

MAINTENANCE_CMD="${ids.maintenance.scriptPath}; echo \$? > $MAINTENANCE_EXIT_FILE"
tmux send-keys -t cmux:maintenance "$MAINTENANCE_CMD" C-m

# Wait for maintenance to complete
log "Waiting for maintenance script to complete..."
TIMEOUT=600  # 10 minutes
ELAPSED=0
while [ ! -f "$MAINTENANCE_EXIT_FILE" ] && [ $ELAPSED -lt $TIMEOUT ]; do
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

if [ ! -f "$MAINTENANCE_EXIT_FILE" ]; then
  log "ERROR: Maintenance script timed out after $TIMEOUT seconds"
  exit 1
fi

MAINTENANCE_EXIT_CODE=$(cat "$MAINTENANCE_EXIT_FILE")
log "Maintenance script completed with exit code: $MAINTENANCE_EXIT_CODE"

if [ "$MAINTENANCE_EXIT_CODE" -ne 0 ]; then
  log "ERROR: Maintenance script failed, aborting dev script startup"
  # Capture last 50 lines from maintenance window
  tmux capture-pane -t cmux:maintenance -p -S -50 >> "$LOG_FILE" 2>&1 || true
  exit 1
fi

# Create dev tmux window
log "Creating tmux window 'dev'"
tmux new-window -t cmux: -n dev

# Run dev script in background (don't wait for it)
log "Starting dev script in background..."
tmux send-keys -t cmux:dev "${ids.dev.scriptPath}" C-m

# Wait a moment to verify the window exists
sleep 2
if tmux list-windows -t cmux | grep -q "dev"; then
  log "Dev script window is running"
else
  log "ERROR: Dev window not found"
  exit 1
fi

log "=== All scripts started successfully ==="
exit 0
`;

  // Write the orchestration script to the runtime directory and execute it in the background
  const command = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}
cat > ${CMUX_RUNTIME_DIR}/run-scripts.sh <<'ORCHESTRATION_EOF'
${runScriptsContent}
ORCHESTRATION_EOF
chmod +x ${CMUX_RUNTIME_DIR}/run-scripts.sh

# Run the script in the background using nohup
# This allows the Vercel function to return immediately
nohup ${CMUX_RUNTIME_DIR}/run-scripts.sh > /var/log/cmux/startup-output.log 2>&1 &

echo "Script orchestration started in background (PID: $!)"
echo "Check /var/log/cmux/startup.log for progress"
`;

  try {
    const result = await instance.exec(`zsh -lc ${singleQuote(command)}`);

    if (result.exit_code !== 0) {
      const stderr = result.stderr?.trim() || "";
      const stdout = result.stdout?.trim() || "";
      const messageParts = [
        `Failed to start script orchestration with exit code ${result.exit_code}`,
        stderr ? `stderr: ${stderr}` : null,
        stdout ? `stdout: ${stdout}` : null,
      ].filter((part): part is string => part !== null);
      return {
        maintenanceError: messageParts.join(" | "),
        devError: null,
      };
    }

    console.log(`[SCRIPT ORCHESTRATION]\n${result.stdout || ""}`);

    // Return success immediately - the scripts will continue running in the background
    return {
      maintenanceError: null,
      devError: null,
    };
  } catch (error) {
    return {
      maintenanceError: `Script orchestration failed: ${error instanceof Error ? error.message : String(error)}`,
      devError: null,
    };
  }
}
