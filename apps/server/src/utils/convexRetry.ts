/**
 * Retry wrapper for Convex mutations to handle transient
 * OptimisticConcurrencyControlFailure errors.
 */
export async function retryOnOptimisticConcurrency<T>(
  fn: () => Promise<T>,
  options?: { retries?: number; baseDelayMs?: number; maxDelayMs?: number }
): Promise<T> {
  const retries = options?.retries ?? 5;
  const baseDelay = options?.baseDelayMs ?? 50;
  const maxDelay = options?.maxDelayMs ?? 1000;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isOptimisticConcurrencyError(err) || attempt === retries) {
        throw err;
      }
      // Exponential backoff with jitter
      const delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt));
      const jitter = Math.random() * 0.3 * delay; // up to 30% jitter
      await sleep(delay + jitter);
    }
  }
  // Should be unreachable - loop always returns or throws
  throw new Error("retryOnOptimisticConcurrency exhausted unexpectedly");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOptimisticConcurrencyError(err: unknown): boolean {
  // Convex client often throws an Error with a JSON string in message
  // like: {"code":"OptimisticConcurrencyControlFailure", ...}
  const anyErr = err as { message?: unknown; code?: unknown } | undefined;
  if (anyErr?.code === "OptimisticConcurrencyControlFailure") return true;

  const msg = anyErr?.message;
  if (typeof msg === "string") {
    try {
      const parsed = JSON.parse(msg);
      if (parsed && parsed.code === "OptimisticConcurrencyControlFailure") {
        return true;
      }
    } catch {
      // not JSON – ignore
    }
    // Fallback substring check
    if (msg.includes("OptimisticConcurrencyControlFailure")) return true;
  }
  return false;
}
