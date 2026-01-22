import { toProxyWorkspaceUrl } from "./toProxyWorkspaceUrl";

type VSCodeProvider = "docker" | "morph" | "other" | "daytona" | undefined;

/**
 * Check if we're running in Electron production mode (https://cmux.local).
 * In this mode, we should NOT rewrite local workspace URLs to http://localhost
 * because that would cause mixed content blocking. Instead, the URL stays as
 * https://cmux-vscode.local and the Electron protocol handler proxies to serve-web.
 */
function isElectronProductionMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  // Electron production mode loads from https://cmux.local
  return window.location.hostname === "cmux.local";
}

/**
 * Get the workspace URL with appropriate serve-web handling based on provider.
 *
 * - For Docker workspaces (provider === "docker"): Uses Docker-forwarded port directly
 * - For local workspaces (provider === "other"): Rewrites to local serve-web
 * - For Morph workspaces (provider === "morph"): Uses Morph URL directly (no rewriting needed)
 *
 * In Electron production mode, local workspace URLs are NOT rewritten to localhost.
 * Instead, the https://cmux-vscode.local placeholder is used and the Electron
 * protocol handler intercepts and proxies the request to the local serve-web server.
 * This avoids mixed content blocking (HTTPS page loading HTTP iframe).
 */
export function getWorkspaceUrl(
  rawWorkspaceUrl: string | null | undefined,
  provider: VSCodeProvider,
  localServeWebBaseUrl: string | null | undefined
): string | null {
  if (!rawWorkspaceUrl) {
    return null;
  }

  // Only use local serve-web for truly local workspaces (provider === "other")
  // Docker and Morph workspaces should use their URLs directly
  const shouldUseLocalServeWeb = provider === "other";

  // In Electron production mode, don't rewrite to http://localhost - let the
  // Electron protocol handler intercept https://cmux-vscode.local and proxy.
  // Rewriting to localhost would cause mixed content blocking.
  const shouldRewriteToLocalhost = shouldUseLocalServeWeb && !isElectronProductionMode();
  const preferredOrigin = shouldRewriteToLocalhost ? localServeWebBaseUrl : null;

  return toProxyWorkspaceUrl(rawWorkspaceUrl, preferredOrigin);
}
