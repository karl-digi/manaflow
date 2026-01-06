const SENTRY_ELECTRON_DSN_ENV = import.meta.env?.NEXT_PUBLIC_SENTRY_ELECTRON_DSN;
const SENTRY_WEB_DSN_ENV = import.meta.env?.NEXT_PUBLIC_SENTRY_WEB_DSN;

export const SENTRY_ELECTRON_DSN = SENTRY_ELECTRON_DSN_ENV?.trim() || undefined;
export const SENTRY_WEB_DSN = SENTRY_WEB_DSN_ENV?.trim() || undefined;
