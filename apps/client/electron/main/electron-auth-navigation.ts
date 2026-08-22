/**
 * Pure helpers for Electron main-window auth navigation.
 *
 * Problem: Stack/GitHub OAuth navigates the main BrowserWindow away from the
 * SPA, and Electron hash history never sees path-style /handler/* callbacks.
 *
 * Decisions (main window):
 * - SPA origins: allow
 * - /handler/* on SPA origin: rewrite to #/handler/* (hash router)
 * - OAuth providers: open dedicated auth window (shared partition)
 * - other http(s): open external browser; keep main on SPA
 */

export type AuthNavDecision =
  | { action: "allow" }
  | { action: "rewrite-hash"; url: string }
  | { action: "auth-window"; url: string }
  | { action: "external"; url: string };

export type ClassifyMainWindowNavigationOptions = {
  /** Origins considered the cmux SPA (e.g. http://localhost:5173, https://cmux.local) */
  spaOrigins: readonly string[];
  /**
   * When false (electron-vite dev / browser history), leave path-style
   * /handler/* callbacks alone so Stack Auth can exchange the OAuth code.
   * Default true for packaged hash-router builds.
   */
  hashRouter?: boolean;
};

const OAUTH_HOST_SUFFIXES = [
  "stack-auth.com",
  "github.com",
  "githubusercontent.com",
  "google.com",
  "accounts.google.com",
  "login.microsoftonline.com",
] as const;

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.replace(/\/$/, "");
  }
}

export function isSpaOrigin(
  rawUrl: string,
  spaOrigins: readonly string[]
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const origin = url.origin;
  return spaOrigins.some((candidate) => normalizeOrigin(candidate) === origin);
}

export function isOAuthProviderUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return OAUTH_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
}

/**
 * Convert path-style Stack handler URLs to hash-router form.
 * http://localhost:5173/handler/oauth-callback?x=1
 *   → http://localhost:5173/?x=1#/handler/oauth-callback
 *
 * Hash history needs the handler path in the hash. Stack's callOAuthCallback
 * reads window.location.search (not the hash), so OAuth query stays on search.
 *
 * Returns null when no rewrite is needed.
 */
export function rewriteHandlerPathToHash(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const hashBody = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const hashQueryIndex = hashBody.indexOf("?");
  const hashPath =
    hashQueryIndex >= 0 ? hashBody.slice(0, hashQueryIndex) : hashBody;
  const hashSearch =
    hashQueryIndex >= 0 ? hashBody.slice(hashQueryIndex + 1) : "";
  const hashIsHandler = hashPath.startsWith("/handler");
  const pathIsHandler = url.pathname.startsWith("/handler");
  if (!hashIsHandler && !pathIsHandler) {
    return null;
  }

  const handlerPath = pathIsHandler ? url.pathname : hashPath;
  const merged = new URLSearchParams(url.search);
  const hashParams = new URLSearchParams(hashSearch);
  for (const [key, value] of hashParams.entries()) {
    if (!merged.has(key)) {
      merged.set(key, value);
    }
  }

  const rewritten = new URL(url.origin);
  rewritten.pathname = pathIsHandler ? "/" : url.pathname;
  rewritten.search = merged.toString();
  rewritten.hash = handlerPath;

  if (rewritten.toString() === url.toString()) {
    return null;
  }
  return rewritten.toString();
}

/**
 * Shared SPA / non-http classification.
 * Returns a decision when the URL is non-http, invalid, or SPA; otherwise null.
 */
function classifySpaNavigation(
  rawUrl: string,
  spaOrigins: readonly string[],
  hashRouter: boolean
): AuthNavDecision | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { action: "allow" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { action: "allow" };
  }

  if (!isSpaOrigin(rawUrl, spaOrigins)) {
    return null;
  }

  if (!hashRouter) {
    return { action: "allow" };
  }

  const rewritten = rewriteHandlerPathToHash(rawUrl);
  if (rewritten) {
    return { action: "rewrite-hash", url: rewritten };
  }
  return { action: "allow" };
}

/**
 * Classify a main-frame navigation for the app window.
 * Non-http(s) schemes (devtools, about, file, chrome-error) are allowed.
 */
export function classifyMainWindowNavigation(
  rawUrl: string,
  options: ClassifyMainWindowNavigationOptions
): AuthNavDecision {
  const spaDecision = classifySpaNavigation(
    rawUrl,
    options.spaOrigins,
    options.hashRouter ?? true
  );
  if (spaDecision) {
    return spaDecision;
  }

  if (isOAuthProviderUrl(rawUrl)) {
    return { action: "auth-window", url: rawUrl };
  }

  return { action: "external", url: rawUrl };
}

/**
 * Auth child window: allow OAuth + SPA; rewrite path handler; otherwise external.
 * Callers close the auth window when SPA callback is reached.
 */
export function classifyAuthWindowNavigation(
  rawUrl: string,
  options: ClassifyMainWindowNavigationOptions
): AuthNavDecision {
  const spaDecision = classifySpaNavigation(
    rawUrl,
    options.spaOrigins,
    options.hashRouter ?? true
  );
  if (spaDecision) {
    return spaDecision;
  }

  if (isOAuthProviderUrl(rawUrl)) {
    return { action: "allow" };
  }

  return { action: "external", url: rawUrl };
}

/** True when URL is a Stack/handler callback on the SPA (path or hash). */
export function isSpaAuthCallback(
  rawUrl: string,
  spaOrigins: readonly string[]
): boolean {
  if (!isSpaOrigin(rawUrl, spaOrigins)) {
    return false;
  }
  try {
    const url = new URL(rawUrl);
    return (
      url.pathname.startsWith("/handler") || url.hash.startsWith("#/handler")
    );
  } catch {
    return false;
  }
}

export function buildSpaOrigins(params: {
  appHost: string;
  electronRendererUrl?: string | null;
  extraOrigins?: readonly string[];
}): string[] {
  const origins = new Set<string>();
  origins.add(`https://${params.appHost}`);
  origins.add(`http://${params.appHost}`);
  origins.add("http://localhost:5173");
  origins.add("http://127.0.0.1:5173");

  if (params.electronRendererUrl) {
    try {
      origins.add(new URL(params.electronRendererUrl).origin);
    } catch {
      // ignore
    }
  }

  for (const extra of params.extraOrigins ?? []) {
    try {
      origins.add(new URL(extra).origin);
    } catch {
      // ignore
    }
  }

  return [...origins];
}
