import { env } from "@/lib/utils/www-env";
import { PostHog } from "posthog-node";

type CaptureOptions = {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
  groups?: Record<string, string | number>;
};

declare global {
  // eslint-disable-next-line no-var
  var __cmuxPosthogClient: PostHog | null | undefined;
}

function getPosthogClient(): PostHog | null {
  if (typeof globalThis.__cmuxPosthogClient !== "undefined") {
    return globalThis.__cmuxPosthogClient;
  }

  if (!env.POSTHOG_API_KEY) {
    globalThis.__cmuxPosthogClient = null;
    return null;
  }

  const host = env.POSTHOG_HOST || "https://app.posthog.com";
  globalThis.__cmuxPosthogClient = new PostHog(env.POSTHOG_API_KEY, {
    host,
  });

  return globalThis.__cmuxPosthogClient;
}

export function captureServerAnalytics({
  event,
  distinctId,
  properties,
  groups,
}: CaptureOptions): void {
  const client = getPosthogClient();
  if (!client) {
    return;
  }

  try {
    client.capture({
      distinctId,
      event,
      properties,
      groups,
    });
  } catch (error) {
    console.warn("[analytics] Failed to send PostHog event", {
      event,
      error,
    });
  }
}
