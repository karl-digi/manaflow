import { onConvexReady } from "@cmux/shared/convex-ready";
import { serverLogger } from "./fileLogger";
import { env } from "./server-env";

export async function waitForConvex(): Promise<void> {
  serverLogger.info("Waiting for convex to be ready...");
  if (process.env.USE_CONVEX_READY === "true") {
    await onConvexReady();
  }

  const maxRetries = 100;
  const retryDelay = 100;
  let attempt = 1;

  for (; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(env.NEXT_PUBLIC_CONVEX_URL, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        serverLogger.info(
          `Convex is ready after ${attempt} ${
            attempt === 1 ? "attempt" : "attempts"
          }`
        );
        return;
      }
    } catch (error) {
      if (attempt > 50) {
        serverLogger.error(
          `Convex connection attempt ${attempt} failed:`,
          error
        );
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  throw new Error(`Convex not ready after ${maxRetries} attempts`);
}
