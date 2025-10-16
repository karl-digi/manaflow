import maintenanceDevRunnerSource from "./maintenanceDevRunner.ts?raw";
import type { MorphInstance } from "./git";
import { singleQuote } from "./shell";

const WORKSPACE_ROOT = "/root/workspace";
const CMUX_RUNTIME_DIR = "/var/tmp/cmux-scripts";
const TMUX_SESSION_NAME = "cmux";
const RUNNER_FILENAME = "maintenance-dev-runner.ts";
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

type RunnerMaintenanceResult = {
  ran: boolean;
  exitCode: number | null;
  durationMs: number;
  error: string | null;
  stderrSnippet: string | null;
};

type RunnerDevResult = {
  ran: boolean;
  windowCreated: boolean;
  sendKeysExitCode: number | null;
  durationMs: number;
  error: string | null;
};

type RunnerOutput = {
  maintenance: RunnerMaintenanceResult;
  dev: RunnerDevResult;
};

const RESULT_PREFIX = "CMUX_MAINT_DEV_RESULT ";

const sanitizeScript = (script: string | undefined): string =>
  script?.trim() ?? "";

const encodeScript = (script: string): string =>
  Buffer.from(script, "utf8").toString("base64");

const extractRunnerOutput = (stdout: string | undefined): RunnerOutput | null => {
  if (!stdout) {
    return null;
  }

  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (line && line.startsWith(RESULT_PREFIX)) {
      const payload = line.slice(RESULT_PREFIX.length);
      try {
        const parsed = JSON.parse(payload) as RunnerOutput;
        return parsed;
      } catch {
        return null;
      }
    }
  }

  return null;
};

const buildRunnerCommand = ({
  maintenanceScript,
  devScript,
  ids,
}: {
  maintenanceScript: string;
  devScript: string;
  ids: ScriptIdentifiers;
}): string => {
  const runnerPath = `${CMUX_RUNTIME_DIR}/${RUNNER_FILENAME}`;

  const maintenanceBase64 = encodeScript(maintenanceScript);
  const devBase64 = encodeScript(devScript);

  const lines = [
    "set -euo pipefail",
    `mkdir -p ${CMUX_RUNTIME_DIR}`,
    `cat <<'__CMUX_RUNNER__' > ${runnerPath}`,
    maintenanceDevRunnerSource,
    "__CMUX_RUNNER__",
    `chmod +x ${runnerPath}`,
    `export CMUX_WORKSPACE_ROOT=${singleQuote(WORKSPACE_ROOT)}`,
    `export CMUX_RUNTIME_DIR=${singleQuote(CMUX_RUNTIME_DIR)}`,
    `export CMUX_TMUX_SESSION=${singleQuote(TMUX_SESSION_NAME)}`,
    `export CMUX_DEV_WINDOW=${singleQuote(ids.dev.windowName)}`,
    `export CMUX_MAINTENANCE_SCRIPT_PATH=${singleQuote(ids.maintenance.scriptPath)}`,
    `export CMUX_DEV_SCRIPT_PATH=${singleQuote(ids.dev.scriptPath)}`,
    `export CMUX_MAINTENANCE_SCRIPT_BASE64=${singleQuote(maintenanceBase64)}`,
    `export CMUX_DEV_SCRIPT_BASE64=${singleQuote(devBase64)}`,
    `bun ${runnerPath}`,
  ];

  return lines.join("\n");
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
  const maintenanceContent = sanitizeScript(maintenanceScript);
  const devContent = sanitizeScript(devScript);

  const hasMaintenance = maintenanceContent.length > 0;
  const hasDev = devContent.length > 0;

  if (!hasMaintenance && !hasDev) {
    return {
      maintenanceError: "Both maintenance and dev scripts are empty",
      devError: null,
    };
  }

  const normalizedMaintenance = hasMaintenance ? maintenanceContent : "";
  const normalizedDev = hasDev ? devContent : "";

  const command = buildRunnerCommand({
    maintenanceScript: normalizedMaintenance,
    devScript: normalizedDev,
    ids,
  });

  try {
    const execResult = await instance.exec(
      `zsh -lc ${singleQuote(command)}`,
    );

    const runnerOutput = extractRunnerOutput(execResult.stdout ?? undefined);

    if (!runnerOutput) {
      const combinedOutput = [execResult.stdout, execResult.stderr]
        .map((value) => (value ? value.trim() : ""))
        .filter((value) => value.length > 0)
        .join(" | ");

      const fallbackError =
        combinedOutput.length > 0
          ? `Failed to parse maintenance/dev runner output | ${combinedOutput}`
          : "Failed to parse maintenance/dev runner output";

      return {
        maintenanceError: hasMaintenance ? fallbackError : null,
        devError: hasDev ? fallbackError : null,
      };
    }

    if (runnerOutput.maintenance.ran) {
      console.log(
        `[maintenance/run] exit=${runnerOutput.maintenance.exitCode ?? "null"} duration=${runnerOutput.maintenance.durationMs.toFixed(0)}ms`,
      );
    }
    if (runnerOutput.dev.ran) {
      console.log(
        `[dev/run] windowCreated=${runnerOutput.dev.windowCreated} duration=${runnerOutput.dev.durationMs.toFixed(0)}ms`,
      );
    }

    const maintenanceError = runnerOutput.maintenance.error
      ? runnerOutput.maintenance.stderrSnippet
        ? `${runnerOutput.maintenance.error} | stderr: ${runnerOutput.maintenance.stderrSnippet}`
        : runnerOutput.maintenance.error
      : null;

    const devError = runnerOutput.dev.error;

    if (execResult.exit_code !== 0) {
      const exitError = `Runner exited with code ${execResult.exit_code}`;
      if (devError === null && hasDev) {
        return {
          maintenanceError,
          devError: exitError,
        };
      }
      if (maintenanceError === null && hasMaintenance) {
        return {
          maintenanceError: exitError,
          devError,
        };
      }
    }

    return {
      maintenanceError,
      devError,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : `Unknown runner execution error: ${String(error)}`;

    return {
      maintenanceError: hasMaintenance ? message : null,
      devError: hasDev ? message : null,
    };
  }
}
