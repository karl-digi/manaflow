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

  let maintenanceError: string | null = null;
  let devError: string | null = null;

  // Use Bun script runner to manage tmux windows in a single exec call
  // This prevents Vercel function timeouts by running everything in the Morph instance
  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const maintenanceScriptPath = `${CMUX_RUNTIME_DIR}/maintenance-${runId}.sh`;
  const devScriptPath = `${CMUX_RUNTIME_DIR}/dev-${runId}.sh`;

  const setupCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}
${
  maintenanceScript && maintenanceScript.trim().length > 0
    ? `cat > ${maintenanceScriptPath} <<'MAINTENANCE_SCRIPT_EOF'
${maintenanceScript}
MAINTENANCE_SCRIPT_EOF
chmod +x ${maintenanceScriptPath}`
    : ""
}
${
  devScript && devScript.trim().length > 0
    ? `cat > ${devScriptPath} <<'DEV_SCRIPT_EOF'
${devScript}
DEV_SCRIPT_EOF
chmod +x ${devScriptPath}`
    : ""
}
# Run the Bun script that manages tmux windows
cd ${WORKSPACE_ROOT}
bun ${WORKSPACE_ROOT}/scripts/run-maintenance-and-dev.ts ${
  maintenanceScript && maintenanceScript.trim().length > 0 ? maintenanceScriptPath : ""
} ${devScript && devScript.trim().length > 0 ? devScriptPath : ""}
`;

  try {
    const result = await instance.exec(`zsh -lc ${singleQuote(setupCommand)}`);

    if (result.exit_code !== 0) {
      const stderr = result.stderr?.trim() || "";
      const stdout = result.stdout?.trim() || "";
      const messageParts = [
        `Script runner exited with code ${result.exit_code}`,
        stderr ? `stderr: ${stderr}` : null,
        stdout ? `stdout: ${stdout}` : null,
      ].filter((part): part is string => part !== null);

      // Check if error is from maintenance or dev script
      // Maintenance script runs first, so if it fails, that's the maintenance error
      if (maintenanceScript && maintenanceScript.trim().length > 0) {
        maintenanceError = messageParts.join(" | ");
      } else {
        devError = messageParts.join(" | ");
      }
    } else {
      console.log(`[SCRIPT RUNNER OUTPUT]\n${result.stdout || ""}`);
    }
  } catch (error) {
    const errorMessage = `Script runner execution failed: ${error instanceof Error ? error.message : String(error)}`;
    // If both scripts exist, we can't determine which failed from the catch block alone
    if (maintenanceScript && maintenanceScript.trim().length > 0) {
      maintenanceError = errorMessage;
    } else if (devScript && devScript.trim().length > 0) {
      devError = errorMessage;
    }
  }

  return {
    maintenanceError,
    devError,
  };
}
