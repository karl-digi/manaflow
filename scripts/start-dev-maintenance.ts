#!/usr/bin/env bun
import { spawn } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

type ExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type ScriptKind = "maintenance" | "dev";

type CliArgs = {
  session: string;
  runtimeDir: string;
  logFile: string;
  maintenanceScript?: string;
  maintenanceWindow?: string;
  devScript?: string;
  devWindow?: string;
};

const DEFAULT_SESSION = "cmux";
const DEFAULT_MAINTENANCE_WINDOW = "maintenance";
const DEFAULT_DEV_WINDOW = "dev";
const SESSION_RETRY_COUNT = 20;
const SESSION_RETRY_DELAY_MS = 500;
const EXIT_FILE_POLL_DELAY_MS = 1000;
const CAPTURE_CHAR_LIMIT = 4000;

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const parsed: Partial<CliArgs> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      // Skip non flag args for now (not expected)
      continue;
    }

    const key = arg.slice(2);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Flag --${key} expects a value`);
    }

    index += 1;

    switch (key) {
      case "session":
        parsed.session = value;
        break;
      case "runtime-dir":
        parsed.runtimeDir = value;
        break;
      case "log-file":
        parsed.logFile = value;
        break;
      case "maintenance-script":
        parsed.maintenanceScript = value;
        break;
      case "maintenance-window":
        parsed.maintenanceWindow = value;
        break;
      case "dev-script":
        parsed.devScript = value;
        break;
      case "dev-window":
        parsed.devWindow = value;
        break;
      default:
        throw new Error(`Unknown flag --${key}`);
    }
  }

  if (!parsed.runtimeDir) {
    throw new Error("Missing required flag --runtime-dir");
  }
  if (!parsed.logFile) {
    throw new Error("Missing required flag --log-file");
  }

  return {
    session: parsed.session ?? DEFAULT_SESSION,
    runtimeDir: parsed.runtimeDir,
    logFile: parsed.logFile,
    maintenanceScript: parsed.maintenanceScript,
    maintenanceWindow:
      parsed.maintenanceWindow ?? DEFAULT_MAINTENANCE_WINDOW,
    devScript: parsed.devScript,
    devWindow: parsed.devWindow ?? DEFAULT_DEV_WINDOW,
  };
}

function ensureLogDir(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function logError(logFile: string, message: string) {
  ensureLogDir(logFile);
  const line = `${new Date().toISOString()} ${message}\n`;
  appendFileSync(logFile, line, { encoding: "utf8" });
}

function truncateOutput(output: string): string {
  if (output.length <= CAPTURE_CHAR_LIMIT) {
    return output;
  }
  return output.slice(output.length - CAPTURE_CHAR_LIMIT);
}

async function run(command: string[]): Promise<ExecResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += String(data);
    });
    child.stderr?.on("data", (data) => {
      stderr += String(data);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

async function waitForSession(session: string): Promise<boolean> {
  for (let attempt = 0; attempt < SESSION_RETRY_COUNT; attempt += 1) {
    const result = await run(["tmux", "has-session", "-t", session]);
    if (result.exitCode === 0) {
      return true;
    }
    await sleep(SESSION_RETRY_DELAY_MS);
  }

  return false;
}

function createWrapperContent(
  kind: ScriptKind,
  scriptPath: string,
  exitCodePath: string,
): string {
  const prefix = kind === "maintenance" ? "MAINTENANCE" : "DEV";
  return `#!/bin/zsh
set -eux
zsh ${scriptPath}
EXIT_CODE=$?
echo "$EXIT_CODE" > ${exitCodePath}
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "[${prefix}] Script exited with code $EXIT_CODE" >&2
else
  echo "[${prefix}] Script completed successfully"
fi
exec zsh
`;
}

async function capturePaneOutput(
  session: string,
  windowName: string,
): Promise<string> {
  const result = await run([
    "tmux",
    "capture-pane",
    "-t",
    `${session}:${windowName}`,
    "-p",
  ]);

  if (result.exitCode !== 0) {
    return "";
  }

  return result.stdout.trim();
}

async function ensureWindowClosed(session: string, windowName: string) {
  const result = await run([
    "tmux",
    "kill-window",
    "-t",
    `${session}:${windowName}`,
  ]);
  if (result.exitCode !== 0) {
    // Swallow errors; window might not exist yet
    return;
  }
}

async function launchScript(
  kind: ScriptKind,
  scriptPath: string,
  windowName: string,
  session: string,
  runtimeDir: string,
  logFile: string,
): Promise<{ error: string | null }> {
  if (!existsSync(scriptPath)) {
    const message = `[${kind}] Script path ${scriptPath} does not exist`;
    logError(logFile, message);
    return { error: message };
  }

  mkdirSync(runtimeDir, { recursive: true });

  const runId = `${kind}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const wrapperPath = `${runtimeDir}/${runId}.sh`;
  const exitCodePath = `${runtimeDir}/${runId}.exit-code`;

  writeFileSync(
    wrapperPath,
    createWrapperContent(kind, scriptPath, exitCodePath),
    { encoding: "utf8" },
  );
  chmodSync(wrapperPath, 0o755);

  await ensureWindowClosed(session, windowName);

  const newWindowResult = await run([
    "tmux",
    "new-window",
    "-t",
    `${session}:`,
    "-n",
    windowName,
    "-d",
    `zsh ${wrapperPath}`,
  ]);

  if (newWindowResult.exitCode !== 0) {
    const message = `[${kind}] Failed to start tmux window: ${
      newWindowResult.stderr || newWindowResult.stdout || "unknown error"
    }`;
    logError(logFile, message);
    rmSync(wrapperPath, { force: true });
    rmSync(exitCodePath, { force: true });
    return { error: message };
  }

  while (!existsSync(exitCodePath)) {
    await sleep(EXIT_FILE_POLL_DELAY_MS);
  }

  let exitCode = 0;
  try {
    const raw = readFileSync(exitCodePath, "utf8").trim();
    exitCode = Number.parseInt(raw, 10);
    if (Number.isNaN(exitCode)) {
      exitCode = 1;
    }
  } catch (error) {
    exitCode = 1;
    const message = `[${kind}] Failed to read exit code: ${String(error)}`;
    logError(logFile, message);
  }

  rmSync(exitCodePath, { force: true });
  rmSync(wrapperPath, { force: true });

  if (exitCode === 0) {
    return { error: null };
  }

  const capturedOutput = truncateOutput(
    await capturePaneOutput(session, windowName),
  );

  const messageParts = [
    `${kind} script exited with code ${exitCode}`,
  ];
  if (capturedOutput) {
    messageParts.push(`output: ${capturedOutput}`);
  }

  const message = messageParts.join(" | ");
  logError(logFile, message);

  return { error: message };
}

await (async () => {
  const args = parseArgs();

  let maintenanceError: string | null = null;
  let devError: string | null = null;

  const sessionReady = await waitForSession(args.session);
  if (!sessionReady) {
    const message = `tmux session ${args.session} not found`;
    logError(args.logFile, message);
    maintenanceError = message;
    devError = devError ?? message;
    console.log(
      JSON.stringify({ maintenanceError, devError }),
    );
    return;
  }

  if (args.maintenanceScript) {
    const result = await launchScript(
      "maintenance",
      args.maintenanceScript,
      args.maintenanceWindow ?? DEFAULT_MAINTENANCE_WINDOW,
      args.session,
      args.runtimeDir,
      args.logFile,
    );
    maintenanceError = result.error;
  }

  if (args.devScript) {
    const result = await launchScript(
      "dev",
      args.devScript,
      args.devWindow ?? DEFAULT_DEV_WINDOW,
      args.session,
      args.runtimeDir,
      args.logFile,
    );
    devError = result.error;
  }

  console.log(JSON.stringify({ maintenanceError, devError }));
})().catch((error) => {
  const message = `start-dev-maintenance failed: ${
    error instanceof Error ? error.message : String(error)
  }`;
  const args = (() => {
    try {
      return parseArgs();
    } catch {
      return null;
    }
  })();

  if (args) {
    logError(args.logFile, message);
    console.error(message);
  } else {
    console.error(message);
  }

  console.log(
    JSON.stringify({ maintenanceError: message, devError: message }),
  );
});
