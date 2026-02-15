import * as Sentry from "@sentry/nextjs";
import { SENTRY_RELEASE } from "@/lib/sentry-release";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (process.env.NODE_ENV !== "development" && SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    release: SENTRY_RELEASE,
    tracesSampleRate: 1,
    enableLogs: true,
    sendDefaultPii: true,
  });
}
