import type Docker from "dockerode";
import type { DockerPullProgress } from "@cmux/shared";

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

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 1500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function coerceErrorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function buildErrorMessage(error: unknown, eventErrors: Set<string>): string {
  const parts: string[] = [];
  const eventMessage = Array.from(eventErrors)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(" | ");
  const errorMessage = coerceErrorMessage(error);

  if (eventMessage) {
    parts.push(eventMessage);
  }
  if (errorMessage && !eventMessage.includes(errorMessage)) {
    parts.push(errorMessage);
  }

  return parts.join(" | ") || "Docker pull failed";
}

export function isRetryableDockerPullError(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  if (NON_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(normalized));
}

type DockerPullProgressEvent = {
  status?: string;
  progress?: string;
  id?: string;
  error?: string;
  errorDetail?: {
    message?: string;
  };
};

export async function pullDockerImageWithRetry({
  docker,
  imageName,
  onProgress,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}: {
  docker: Docker;
  imageName: string;
  onProgress?: (event: DockerPullProgress) => void;
  maxAttempts?: number;
  retryDelayMs?: number;
}): Promise<void> {
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt === 1) {
      onProgress?.({
        imageName,
        phase: "start",
        status: `Starting Docker pull for ${imageName}`,
        attempt,
        maxAttempts,
      });
    } else {
      onProgress?.({
        imageName,
        phase: "retry",
        status: `Retrying Docker pull (${attempt}/${maxAttempts})`,
        attempt,
        maxAttempts,
        error: lastError ?? undefined,
      });
    }

    const eventErrors = new Set<string>();

    try {
      const stream = await docker.pull(imageName);

      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(
          stream,
          (err: Error | null) => {
            if (err) {
              reject(err);
              return;
            }

            if (eventErrors.size > 0) {
              reject(new Error(Array.from(eventErrors).join(" | ")));
              return;
            }

            resolve();
          },
          (event: DockerPullProgressEvent) => {
            const eventError = event.errorDetail?.message ?? event.error;
            if (eventError) {
              eventErrors.add(eventError);
              return;
            }

            if (event.status) {
              onProgress?.({
                imageName,
                phase: "progress",
                status: event.status,
                progress: event.progress,
                id: event.id,
                attempt,
                maxAttempts,
              });
            }
          }
        );
      });

      onProgress?.({
        imageName,
        phase: "complete",
        status: "Docker pull complete",
        attempt,
        maxAttempts,
      });

      return;
    } catch (error) {
      const message = buildErrorMessage(error, eventErrors);
      lastError = message;

      if (attempt < maxAttempts && isRetryableDockerPullError(message)) {
        await delay(retryDelayMs * attempt);
        continue;
      }

      onProgress?.({
        imageName,
        phase: "error",
        status: "Docker pull failed",
        error: message,
        attempt,
        maxAttempts,
      });

      throw new Error(message);
    }
  }

  throw new Error(lastError ?? "Docker pull failed");
}
