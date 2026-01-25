import { spawn, execSync } from "node:child_process";
import { appendFileSync, createWriteStream } from "node:fs";
import path from "node:path";

const RETRYABLE_ERROR_PATTERNS = [
  /rpc error/i,
  /error while receiving ack/i,
  /unexpected eof/i,
  /connection reset/i,
  /connection closed/i,
  /transport is closing/i,
  /error reading from server/i,
  /tls handshake timeout/i,
  /i\/o timeout/i,
  /context deadline exceeded/i,
];

const NON_RETRYABLE_ERROR_PATTERNS = [
  /unauthorized/i,
  /authentication/i,
  /manifest unknown/i,
  /not found/i,
  /no such image/i,
  /permission denied/i,
  /no space left/i,
  /disk quota/i,
  /too many requests/i,
];

const MAX_ERROR_LINES = 6;
const MAX_PULL_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDockerPullError(message: string): boolean {
  if (!message) return false;
  if (NON_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return false;
  }
  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function isLikelyErrorLine(line: string): boolean {
  const normalized = line.toLowerCase();
  return (
    normalized.includes("error") ||
    normalized.includes("manifest unknown") ||
    normalized.includes("unauthorized") ||
    normalized.includes("denied") ||
    normalized.includes("not found") ||
    normalized.includes("no space") ||
    normalized.includes("rpc") ||
    normalized.includes("timeout") ||
    normalized.includes("connection")
  );
}

function checkImageExists(imageName: string): boolean {
  try {
    execSync(`docker image inspect ${imageName}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function runPullAttempt(
  imageName: string,
  logStream: ReturnType<typeof createWriteStream>
): Promise<{ success: boolean; errorMessage: string; retryable: boolean }> {
  const errorLines: string[] = [];

  const pullProcess = spawn("docker", ["pull", imageName]);

  pullProcess.stdout.on("data", (data) => {
    logStream.write(`[STDOUT] ${data}`);
  });

  pullProcess.stderr.on("data", (data) => {
    const text = data.toString();
    logStream.write(`[STDERR] ${text}`);
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (isLikelyErrorLine(trimmed)) {
        errorLines.push(trimmed);
        if (errorLines.length > MAX_ERROR_LINES) {
          errorLines.shift();
        }
      }
    }
  });

  const { code, error } = await new Promise<{
    code: number | null;
    error?: string;
  }>((resolve) => {
    let settled = false;
    const settle = (payload: { code: number | null; error?: string }) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    pullProcess.on("error", (spawnError) => {
      settle({ code: null, error: spawnError.message });
    });

    pullProcess.on("close", (exitCode) => {
      settle({ code: exitCode });
    });
  });

  if (code === 0) {
    return { success: true, errorMessage: "", retryable: false };
  }

  const errorMessage =
    errorLines.join(" | ") ||
    error ||
    (code === null ? "Docker pull failed to start" : `Docker pull failed with code ${code}`);

  return {
    success: false,
    errorMessage,
    retryable: isRetryableDockerPullError(errorMessage),
  };
}

export async function pullDockerImage(
  imageName: string,
  logsDir: string
): Promise<void> {
  const dockerPullLogPath = path.join(logsDir, "docker-pull.log");

  // Check if image already exists
  if (checkImageExists(imageName)) {
    const timestamp = new Date().toISOString();
    appendFileSync(
      dockerPullLogPath,
      `\n[${timestamp}] Docker image ${imageName} already exists locally\n`
    );
    return;
  }

  const dockerPullLogStream = createWriteStream(dockerPullLogPath, {
    flags: "a",
  });

  let lastErrorMessage = "";

  for (let attempt = 1; attempt <= MAX_PULL_ATTEMPTS; attempt += 1) {
    const timestamp = new Date().toISOString();
    dockerPullLogStream.write(
      `\n[${timestamp}] Starting Docker pull for ${imageName} (attempt ${attempt}/${MAX_PULL_ATTEMPTS})\n`
    );

    const { success, errorMessage, retryable } = await runPullAttempt(
      imageName,
      dockerPullLogStream
    );

    if (success) {
      const endTimestamp = new Date().toISOString();
      const successMsg = `[${endTimestamp}] Docker image ${imageName} pulled successfully\n`;
      dockerPullLogStream.write(successMsg);
      dockerPullLogStream.end();
      return;
    }

    lastErrorMessage = errorMessage;

    const failTimestamp = new Date().toISOString();
    dockerPullLogStream.write(
      `[${failTimestamp}] Docker pull failed: ${errorMessage}\n`
    );

    if (attempt < MAX_PULL_ATTEMPTS && retryable) {
      const retryTimestamp = new Date().toISOString();
      dockerPullLogStream.write(
        `[${retryTimestamp}] Retrying Docker pull after error (attempt ${
          attempt + 1
        }/${MAX_PULL_ATTEMPTS})\n`
      );
      await delay(RETRY_DELAY_MS * attempt);
      continue;
    }

    dockerPullLogStream.end();
    return;
  }

  if (lastErrorMessage) {
    const endTimestamp = new Date().toISOString();
    dockerPullLogStream.write(
      `[${endTimestamp}] Docker image pull failed: ${lastErrorMessage}\n`
    );
    dockerPullLogStream.end();
  }
}
