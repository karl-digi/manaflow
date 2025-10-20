import type { MorphInstance } from "./git";
import { singleQuote } from "./shell";

const WORKSPACE_ROOT = "/root/workspace";
const CMUX_RUNTIME_DIR = "/var/tmp/cmux-scripts";
const MAINTENANCE_WINDOW_NAME = "maintenance";
const MAINTENANCE_SCRIPT_FILENAME = "maintenance.sh";
const DEV_WINDOW_NAME = "dev";
const DEV_SCRIPT_FILENAME = "dev.sh";
const CHILD_RUNNER_FILENAME = "script-child.cjs";
const ORCHESTRATOR_FILENAME = "script-orchestrator.cjs";

const CHILD_RUNNER_SCRIPT_LINES = [
  "#!/usr/bin/env node",
  "const { spawn } = require('node:child_process');",
  "const fs = require('node:fs');",
  "",
  "const [, , role, scriptPath, exitCodePath, logFileArg] = process.argv;",
  "",
  "if (!role || !scriptPath || !exitCodePath) {",
  "  console.error('[cmux-child] Missing required arguments');",
  "  process.exit(1);",
  "}",
  "",
  "const logFilePath =",
  "  logFileArg && logFileArg !== 'null' && logFileArg !== 'undefined' && logFileArg.length > 0",
  "    ? logFileArg",
  "    : null;",
  "",
  "const appendLog = (message) => {",
  "  if (!logFilePath) {",
  "    return;",
  "  }",
  "  const line = `[${new Date().toISOString()}] ${message}\\n`;",
  "  try {",
  "    fs.appendFileSync(logFilePath, line);",
  "  } catch (error) {",
  "    const errorMessage = error instanceof Error ? error.message : String(error);",
  "    console.error(`[cmux-child] Failed to append to log: ${errorMessage}`);",
  "  }",
  "};",
  "",
  "appendLog(`Starting ${role} child for ${scriptPath}`);",
  "",
  "let child;",
  "try {",
  "  child = spawn('zsh', [scriptPath], {",
  "    stdio: 'inherit',",
  "    env: process.env,",
  "  });",
  "} catch (error) {",
  "  const errorMessage = error instanceof Error ? error.message : String(error);",
  "  appendLog(`Failed to start ${role} child: ${errorMessage}`);",
  "  try {",
  "    fs.writeFileSync(exitCodePath, '1');",
  "  } catch (writeError) {",
  "    const writeMessage = writeError instanceof Error ? writeError.message : String(writeError);",
  "    console.error(`[cmux-child] Failed to write exit code file: ${writeMessage}`);",
  "  }",
  "  process.exit(1);",
  "}",
  "",
  "const forwardSignal = (signal) => {",
  "  if (!child.killed) {",
  "    child.kill(signal);",
  "  }",
  "};",
  "",
  "process.on('SIGINT', forwardSignal);",
  "process.on('SIGTERM', forwardSignal);",
  "",
  "child.on('error', (error) => {",
  "  const errorMessage = error instanceof Error ? error.message : String(error);",
  "  appendLog(`${role} child process error: ${errorMessage}`);",
  "});",
  "",
  "child.on('close', (code, signal) => {",
  "  process.removeListener('SIGINT', forwardSignal);",
  "  process.removeListener('SIGTERM', forwardSignal);",
  "  const exitCode = typeof code === 'number' ? code : signal ? 128 : 1;",
  "  appendLog(`${role} child exited with code ${exitCode}`);",
  "  try {",
  "    fs.writeFileSync(exitCodePath, String(exitCode));",
  "  } catch (error) {",
  "    const errorMessage = error instanceof Error ? error.message : String(error);",
  "    console.error(`[cmux-child] Failed to write exit code file: ${errorMessage}`);",
  "  }",
  "  process.exit(exitCode);",
  "});",
];

const CHILD_RUNNER_SCRIPT = CHILD_RUNNER_SCRIPT_LINES.join("\n");

const ORCHESTRATOR_SCRIPT_LINES = [
  "#!/usr/bin/env node",
  "const { spawn } = require('node:child_process');",
  "const fs = require('node:fs');",
  "const fsPromises = require('node:fs/promises');",
  "const { setTimeout: sleep } = require('node:timers/promises');",
  "",
  "const [, , configPath] = process.argv;",
  "",
  "if (!configPath) {",
  "  console.error('[cmux-orchestrator] Missing config path');",
  "  process.exit(1);",
  "}",
  "",
  "let config;",
  "try {",
  "  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));",
  "} catch (error) {",
  "  const errorMessage = error instanceof Error ? error.message : String(error);",
  "  console.error(`[cmux-orchestrator] Failed to read config: ${errorMessage}`);",
  "  process.exit(1);",
  "}",
  "",
  "const logFilePath =",
  "  typeof config.logFilePath === 'string' && config.logFilePath.length > 0",
  "    ? config.logFilePath",
  "    : null;",
  "",
  "const appendLog = (message) => {",
  "  const line = `[${new Date().toISOString()}] ${message}`;",
  "  if (logFilePath) {",
  "    try {",
  "      fs.appendFileSync(logFilePath, `${line}\\n`);",
  "    } catch (error) {",
  "      const errorMessage = error instanceof Error ? error.message : String(error);",
  "      console.error(`[cmux-orchestrator] Failed to append to log: ${errorMessage}`);",
  "    }",
  "  }",
  "  console.log(line);",
  "};",
  "",
  "const shellEscape = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;",
  "",
  "const runTmux = (args) => {",
  "  return new Promise((resolve, reject) => {",
  "    const child = spawn('tmux', args, {",
  "      stdio: ['ignore', 'pipe', 'pipe'],",
  "    });",
  "",
  "    let stdout = '';",
  "    let stderr = '';",
  "",
  "    child.stdout.on('data', (chunk) => {",
  "      stdout += chunk.toString();",
  "    });",
  "",
  "    child.stderr.on('data', (chunk) => {",
  "      stderr += chunk.toString();",
  "    });",
  "",
  "    child.on('error', (error) => {",
  "      reject(error);",
  "    });",
  "",
  "    child.on('close', (code) => {",
  "      if (code === 0) {",
  "        resolve({ stdout, stderr });",
  "        return;",
  "      }",
  "      const error = new Error(`tmux command failed with code ${code}`);",
  "      error.stdout = stdout;",
  "      error.stderr = stderr;",
  "      error.code = code;",
  "      reject(error);",
  "    });",
  "  });",
  "};",
  "",
  "const ensureTmuxSession = async () => {",
  "  try {",
  "    await runTmux(['has-session', '-t', config.sessionName]);",
  "  } catch (error) {",
  "    const errorMessage = error instanceof Error ? error.message : String(error);",
  "    throw new Error(`tmux session '${config.sessionName}' not found: ${errorMessage}`);",
  "  }",
  "};",
  "",
  "const removeWindowIfExists = async (windowName) => {",
  "  try {",
  "    await runTmux(['kill-window', '-t', `${config.sessionName}:${windowName}`]);",
  "  } catch {",
  "    // ignore missing windows",
  "  }",
  "};",
  "",
  "const buildChildCommand = (scriptConfig) => {",
  "  const nodeBin =",
  "    typeof config.nodeBin === 'string' && config.nodeBin.length > 0 ? config.nodeBin : 'node';",
  "  const args = [",
  "    shellEscape(nodeBin),",
  "    shellEscape(config.childRunnerPath),",
  "    shellEscape(scriptConfig.type),",
  "    shellEscape(scriptConfig.scriptPath),",
  "    shellEscape(scriptConfig.exitCodePath),",
  "    scriptConfig.logFilePath ? shellEscape(scriptConfig.logFilePath) : "''",",
  "  ].join(' ');",
  "  const envAssignments = [",
  "    `CMUX_CHILD_ROLE=${scriptConfig.type}`,
  "    `CMUX_KEEP_INTERACTIVE=${scriptConfig.keepShell ? '1' : '0'}`,
  "  ].join(' ');",
  "  const command = `${envAssignments} ${args}`;",
  "  if (scriptConfig.keepShell) {",
  "    return `${command}; exec zsh`;",
  "  }",
  "  return command;",
  "};",
  "",
  "const startScriptWindow = async (scriptConfig) => {",
  "  await removeWindowIfExists(scriptConfig.windowName);",
  "  const command = buildChildCommand(scriptConfig);",
  "  await runTmux([",
  "    'new-window',",
  "    '-t',",
  "    `${config.sessionName}:`,",
  "    '-n',",
  "    scriptConfig.windowName,",
  "    '-d',",
  "    'zsh',",
  "    '-lc',",
  "    command,",
  "  ]);",
  "};",
  "",
  "const waitForExitCode = async (scriptConfig) => {",
  "  const pollIntervalMs =",
  "    typeof config.pollIntervalMs === 'number' ? config.pollIntervalMs : 1000;",
  "  const progressIntervalMs =",
  "    typeof config.progressLogIntervalMs === 'number' ? config.progressLogIntervalMs : 15000;",
  "  const start = Date.now();",
  "  appendLog(`Waiting for ${scriptConfig.type} exit file at ${scriptConfig.exitCodePath}`);",
  "",
  "  while (true) {",
  "    try {",
  "      const exitCodeRaw = await fsPromises.readFile(scriptConfig.exitCodePath, 'utf8');",
  "      return exitCodeRaw.trim();",
  "    } catch {",
  "      const elapsed = Date.now() - start;",
  "      if (elapsed >= progressIntervalMs && elapsed % progressIntervalMs < pollIntervalMs) {",
  "        appendLog(`Still waiting for ${scriptConfig.type} completion (elapsed ${Math.round(elapsed / 1000)}s)`);",
  "      }",
  "      await sleep(pollIntervalMs);",
  "    }",
  "  }",
  "};",
  "",
  "const orchestrate = async () => {",
  "  await ensureTmuxSession();",
  "",
  "  if (config.maintenance) {",
  "    appendLog('Starting maintenance script in tmux window');",
  "    await startScriptWindow(config.maintenance);",
  "    const maintenanceExitCode = await waitForExitCode(config.maintenance);",
  "    appendLog(`Maintenance script finished with exit code ${maintenanceExitCode}`);",
  "  } else {",
  "    appendLog('No maintenance script configured');",
  "  }",
  "",
  "  if (config.dev) {",
  "    if (config.maintenance) {",
  "      appendLog('Launching dev script now that maintenance has completed');",
  "    } else {",
  "      appendLog('Launching dev script without maintenance prerequisite');",
  "    }",
  "    await startScriptWindow(config.dev);",
  "    if (config.dev.waitForExit) {",
  "      const devExitCode = await waitForExitCode(config.dev);",
  "      appendLog(`Dev script finished with exit code ${devExitCode}`);",
  "    } else {",
  "      appendLog('Dev script started (not waiting for exit)');",
  "    }",
  "  } else {",
  "    appendLog('No dev script configured');",
  "  }",
  "};",
  "",
  "orchestrate()",
  "  .then(() => {",
  "    appendLog('Orchestrator completed');",
  "  })",
  "  .catch((error) => {",
  "    const errorMessage =",
  "      error instanceof Error && error.stack",
  "        ? error.stack",
  "        : error instanceof Error",
  "          ? error.message",
  "          : String(error);",
  "    appendLog(`Orchestrator failed: ${errorMessage}`);",
  "    process.exit(1);",
  "  });",
];

const ORCHESTRATOR_SCRIPT = ORCHESTRATOR_SCRIPT_LINES.join("\n");

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

  const trimmedMaintenance = maintenanceScript?.trim() ?? "";
  const trimmedDev = devScript?.trim() ?? "";

  if (trimmedMaintenance.length === 0 && trimmedDev.length === 0) {
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

  const hasMaintenance = trimmedMaintenance.length > 0;
  const hasDev = trimmedDev.length > 0;

  const runId = `scripts_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  const childRunnerPath = `${CMUX_RUNTIME_DIR}/${CHILD_RUNNER_FILENAME}`;
  const orchestratorScriptPath = `${CMUX_RUNTIME_DIR}/${ORCHESTRATOR_FILENAME}`;
  const orchestratorConfigPath = `${CMUX_RUNTIME_DIR}/script-orchestrator-config-${runId}.json`;
  const orchestratorLogPath = `${CMUX_RUNTIME_DIR}/script-orchestrator-${runId}.log`;

  const maintenanceExitCodePath = `${ids.maintenance.scriptPath}.${runId}.exit-code`;
  const maintenanceLogPath = `${ids.maintenance.scriptPath}.${runId}.log`;
  const devExitCodePath = `${ids.dev.scriptPath}.${runId}.exit-code`;
  const devLogPath = `${ids.dev.scriptPath}.${runId}.log`;

  const maintenanceScriptContent = hasMaintenance
    ? `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \$(date) ==="
${trimmedMaintenance}
echo "=== Maintenance Script Completed at \$(date) ==="
`
    : null;

  const devScriptContent = hasDev
    ? `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \$(date) ==="
${trimmedDev}
`
    : null;

  type RemoteScriptConfig = {
    type: "maintenance" | "dev";
    windowName: string;
    scriptPath: string;
    exitCodePath: string;
    logFilePath?: string;
    keepShell: boolean;
    waitForExit: boolean;
  };

  const orchestratorConfig: {
    sessionName: string;
    nodeBin: string;
    childRunnerPath: string;
    logFilePath: string;
    pollIntervalMs: number;
    progressLogIntervalMs: number;
    runId: string;
    maintenance?: RemoteScriptConfig;
    dev?: RemoteScriptConfig;
  } = {
    sessionName: "cmux",
    nodeBin: "node",
    childRunnerPath,
    logFilePath: orchestratorLogPath,
    pollIntervalMs: 1000,
    progressLogIntervalMs: 15000,
    runId,
  };

  if (hasMaintenance && maintenanceScriptContent) {
    orchestratorConfig.maintenance = {
      type: "maintenance",
      windowName: ids.maintenance.windowName,
      scriptPath: ids.maintenance.scriptPath,
      exitCodePath: maintenanceExitCodePath,
      logFilePath: maintenanceLogPath,
      keepShell: true,
      waitForExit: true,
    };
  }

  if (hasDev && devScriptContent) {
    orchestratorConfig.dev = {
      type: "dev",
      windowName: ids.dev.windowName,
      scriptPath: ids.dev.scriptPath,
      exitCodePath: devExitCodePath,
      logFilePath: devLogPath,
      keepShell: false,
      waitForExit: false,
    };
  }

  const configJson = JSON.stringify(orchestratorConfig, null, 2);

  const bootstrapLines: string[] = [
    "set -eu",
    `mkdir -p ${CMUX_RUNTIME_DIR}`,
  ];

  bootstrapLines.push(
    `cat <<'CHILD_EOF' > ${childRunnerPath}`,
    CHILD_RUNNER_SCRIPT,
    "CHILD_EOF",
    `chmod +x ${childRunnerPath}`,
  );

  bootstrapLines.push(
    `cat <<'ORCH_EOF' > ${orchestratorScriptPath}`,
    ORCHESTRATOR_SCRIPT,
    "ORCH_EOF",
    `chmod +x ${orchestratorScriptPath}`,
  );

  if (hasMaintenance && maintenanceScriptContent) {
    bootstrapLines.push(
      `cat <<'MAINT_EOF' > ${ids.maintenance.scriptPath}`,
      maintenanceScriptContent,
      "MAINT_EOF",
      `chmod +x ${ids.maintenance.scriptPath}`,
      `rm -f ${maintenanceExitCodePath}`,
      `: > ${maintenanceLogPath}`,
    );
  } else {
    bootstrapLines.push(`rm -f ${ids.maintenance.scriptPath}`);
  }

  if (hasDev && devScriptContent) {
    bootstrapLines.push(
      `cat <<'DEV_EOF' > ${ids.dev.scriptPath}`,
      devScriptContent,
      "DEV_EOF",
      `chmod +x ${ids.dev.scriptPath}`,
      `rm -f ${devExitCodePath}`,
      `: > ${devLogPath}`,
    );
  } else {
    bootstrapLines.push(`rm -f ${ids.dev.scriptPath}`);
  }

  bootstrapLines.push(
    `cat <<'CONFIG_EOF' > ${orchestratorConfigPath}`,
    configJson,
    "CONFIG_EOF",
  );

  bootstrapLines.push(`: > ${orchestratorLogPath}`);

  bootstrapLines.push(
    "command -v node >/dev/null 2>&1 || { echo 'node binary not found' >&2; exit 1; }",
  );
  bootstrapLines.push(
    "command -v tmux >/dev/null 2>&1 || { echo 'tmux binary not found' >&2; exit 1; }",
  );
  bootstrapLines.push(waitForTmuxSession);
  bootstrapLines.push(
    `nohup node ${orchestratorScriptPath} ${orchestratorConfigPath} >> ${orchestratorLogPath} 2>&1 &`,
    `echo "[cmux] Launched orchestrator (log: ${orchestratorLogPath})"`,
  );

  const bootstrapCommand = bootstrapLines.join("\n");

  let maintenanceError: string | null = null;
  let devError: string | null = null;

  try {
    const result = await instance.exec(`zsh -lc ${singleQuote(bootstrapCommand)}`);

    if (result.exit_code !== 0) {
      const stderr = result.stderr?.trim() || "";
      const stdout = result.stdout?.trim() || "";
      const messageParts = [
        `Failed to launch orchestrator (exit code ${result.exit_code})`,
        stderr ? `stderr: ${stderr}` : null,
        stdout ? `stdout: ${stdout}` : null,
      ].filter((part): part is string => part !== null);
      const message = messageParts.join(" | ");

      if (hasMaintenance) {
        maintenanceError = message;
      }
      if (!hasMaintenance || hasDev) {
        devError = message;
      }
    } else {
      if (result.stdout) {
        console.log(`[SCRIPT ORCHESTRATOR] ${result.stdout.trim()}`);
      }
      if (result.stderr) {
        console.log(`[SCRIPT ORCHESTRATOR STDERR] ${result.stderr.trim()}`);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const message = `Failed to initialize maintenance/dev orchestrator: ${errorMessage}`;
    if (hasMaintenance) {
      maintenanceError = message;
    }
    if (hasDev) {
      devError = message;
    }
  }

  return {
    maintenanceError,
    devError,
  };
}
