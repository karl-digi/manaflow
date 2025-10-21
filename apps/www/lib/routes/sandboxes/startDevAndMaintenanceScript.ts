import type { MorphInstance } from "./git";
import { singleQuote } from "./shell";

const WORKSPACE_ROOT = "/root/workspace";
const CMUX_RUNTIME_DIR = "/var/tmp/cmux-scripts";
const MAINTENANCE_WINDOW_NAME = "maintenance";
const MAINTENANCE_SCRIPT_FILENAME = "maintenance.sh";
const DEV_WINDOW_NAME = "dev";
const DEV_SCRIPT_FILENAME = "dev.sh";
const SCRIPT_ERROR_LOG_PATH = "/var/log/cmux/start-dev-maintenance.log";

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

const parseRunnerResult = (
  stdout: string | null | undefined,
): ScriptResult | null => {
  const trimmed = stdout?.trim();
  if (!trimmed || trimmed.length === 0) {
    return null;
  }

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines.at(-1);
  if (!lastLine) {
    return null;
  }

  try {
    const parsed = JSON.parse(lastLine) as Partial<ScriptResult>;
    const normalize = (value: unknown): string | null => {
      if (value === null || value === undefined) {
        return null;
      }
      if (typeof value === "string") {
        return value;
      }
      return String(value);
    };

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "maintenanceError" in parsed &&
      "devError" in parsed
    ) {
      return {
        maintenanceError: normalize(parsed.maintenanceError),
        devError: normalize(parsed.devError),
      };
    }
  } catch (error) {
    console.error(
      "[startDevAndMaintenance] Failed to parse runner output:",
      error,
    );
  }

  return null;
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

  const trimmedMaintenanceScript = maintenanceScript?.trim() ?? "";
  const trimmedDevScript = devScript?.trim() ?? "";
  const hasMaintenanceScript = trimmedMaintenanceScript.length > 0;
  const hasDevScript = trimmedDevScript.length > 0;

  const commandLines: string[] = [
    "set -eu",
    `cd ${WORKSPACE_ROOT}`,
    `mkdir -p ${CMUX_RUNTIME_DIR}`,
  ];

  if (hasMaintenanceScript) {
    const maintenanceScriptContent = `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \\$(date) ==="
${trimmedMaintenanceScript}
echo "=== Maintenance Script Completed at \\$(date) ==="
`;

    commandLines.push(
      `cat > ${ids.maintenance.scriptPath} <<'SCRIPT_EOF'\n${maintenanceScriptContent}\nSCRIPT_EOF`,
      `chmod +x ${ids.maintenance.scriptPath}`,
    );
  } else {
    commandLines.push(`rm -f ${ids.maintenance.scriptPath}`);
  }

  if (hasDevScript) {
    const devScriptContent = `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \\$(date) ==="
${trimmedDevScript}
`;

    commandLines.push(
      `cat > ${ids.dev.scriptPath} <<'SCRIPT_EOF'\n${devScriptContent}\nSCRIPT_EOF`,
      `chmod +x ${ids.dev.scriptPath}`,
    );
  } else {
    commandLines.push(`rm -f ${ids.dev.scriptPath}`);
  }

  const bunArgs: string[] = [
    "bun",
    "run",
    "--silent",
    "scripts/start-dev-maintenance.ts",
    "--runtime-dir",
    CMUX_RUNTIME_DIR,
    "--session",
    "cmux",
    "--log-file",
    SCRIPT_ERROR_LOG_PATH,
  ];

  if (hasMaintenanceScript) {
    bunArgs.push(
      "--maintenance-script",
      ids.maintenance.scriptPath,
      "--maintenance-window",
      ids.maintenance.windowName,
    );
  }

  if (hasDevScript) {
    bunArgs.push(
      "--dev-script",
      ids.dev.scriptPath,
      "--dev-window",
      ids.dev.windowName,
    );
  }

  commandLines.push(bunArgs.map((arg) => singleQuote(arg)).join(" "));

  const remoteCommand = commandLines.join("\n");

  let maintenanceError: string | null = null;
  let devError: string | null = null;

  try {
    const execResult = await instance.exec(
      `zsh -lc ${singleQuote(remoteCommand)}`,
    );

    const parsed = parseRunnerResult(execResult.stdout);
    if (parsed) {
      maintenanceError = parsed.maintenanceError;
      devError = parsed.devError;
    }

    if (execResult.exit_code !== 0) {
      const stderr = execResult.stderr?.trim() ?? "";
      const stdout = execResult.stdout?.trim() ?? "";
      const messageParts = [
        `start-dev-maintenance exited with code ${execResult.exit_code}`,
        stderr.length > 0 ? `stderr: ${stderr}` : null,
        stdout.length > 0 ? `stdout: ${stdout}` : null,
      ].filter((part): part is string => part !== null);

      const message =
        messageParts.join(" | ") ||
        `start-dev-maintenance exited with code ${execResult.exit_code}`;
      if (!maintenanceError) {
        maintenanceError = message;
      }
      if (!devError) {
        devError = message;
      }
    }
  } catch (error) {
    const message = `Maintenance/dev runner execution failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
    if (!maintenanceError) {
      maintenanceError = message;
    }
    if (!devError) {
      devError = message;
    }
  }

  return {
    maintenanceError,
    devError,
  };
}
