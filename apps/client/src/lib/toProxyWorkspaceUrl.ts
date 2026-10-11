import {
  LOCAL_VSCODE_PLACEHOLDER_HOST,
  isLoopbackHostname,
} from "@cmux/shared";

const MORPH_HOST_REGEX = /^port-(\d+)-morphvm-([^.]+)\.http\.cloud\.morph\.so$/;

interface MorphUrlComponents {
  url: URL;
  morphId: string;
  port: number;
}

export function normalizeWorkspaceOrigin(origin: string | null): string | null {
  if (!origin) {
    return null;
  }

  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`;
  } catch (error) {
    console.debug("[toProxyWorkspaceUrl] Invalid origin URL:", origin, error);
    return null;
  }
}

export function rewriteLocalWorkspaceUrlIfNeeded(
  url: string,
  preferredOrigin?: string | null
): string {
  if (!shouldRewriteUrl(url)) {
    return url;
  }

  const origin = normalizeWorkspaceOrigin(preferredOrigin ?? null);
  if (!origin) {
    return url;
  }

  try {
    const target = new URL(url);
    const originUrl = new URL(origin);
    target.protocol = originUrl.protocol;
    target.hostname = originUrl.hostname;
    target.port = originUrl.port;
    return target.toString();
  } catch (error) {
    console.debug("[toProxyWorkspaceUrl] Failed to rewrite URL:", { url, origin }, error);
    return url;
  }
}

function shouldRewriteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    return (
      isLoopbackHostname(hostname) ||
      hostname.toLowerCase() === LOCAL_VSCODE_PLACEHOLDER_HOST
    );
  } catch (error) {
    console.debug("[toProxyWorkspaceUrl] Invalid URL for rewrite check:", url, error);
    return false;
  }
}

function parseMorphUrl(input: string): MorphUrlComponents | null {
  if (!input.includes("morph.so")) {
    return null;
  }

  try {
    const url = new URL(input);
    const match = url.hostname.match(MORPH_HOST_REGEX);

    if (!match) {
      return null;
    }

    const [, portString, morphId] = match;
    const port = Number.parseInt(portString, 10);

    if (Number.isNaN(port)) {
      return null;
    }

    return {
      url,
      morphId,
      port,
    };
  } catch (error) {
    console.debug("[toProxyWorkspaceUrl] Failed to parse Morph URL:", input, error);
    return null;
  }
}

function createMorphPortUrl(
  components: MorphUrlComponents,
  port: number
): URL {
  const url = new URL(components.url.toString());
  url.hostname = `port-${port}-morphvm-${components.morphId}.http.cloud.morph.so`;
  return url;
}

const NO_VNC_VIEWER_DEFAULT_PARAMS: ReadonlyArray<readonly [string, string]> = [
  ["autoconnect", "1"],
  ["resize", "scale"],
  // Note: reconnect params removed - they don't help with CF Worker idle timeout
  // and may interfere with focus management when noVNC reconnects
];

function applyNoVncViewerDefaults(
  url: URL,
  preserveExistingSearchParams = true
): void {
  for (const [key, value] of NO_VNC_VIEWER_DEFAULT_PARAMS) {
    if (preserveExistingSearchParams && url.searchParams.has(key)) {
      continue;
    }
    url.searchParams.set(key, value);
  }

  // noVNC opens `path` (default websockify) without forwarding tkn. Electron
  // webviews often omit the VNC session cookie on the WebSocket upgrade, so
  // put the token on the websockify URL when the viewer already has tkn.
  const tkn = url.searchParams.get("tkn") || url.searchParams.get("token");
  if (tkn && !(preserveExistingSearchParams && url.searchParams.has("path"))) {
    url.searchParams.set("path", `websockify?tkn=${tkn}`);
  }
}

export function toProxyWorkspaceUrl(
  workspaceUrl: string,
  preferredOrigin?: string | null
): string {
  return rewriteLocalWorkspaceUrlIfNeeded(workspaceUrl, preferredOrigin);
}

export function toMorphVncUrl(sourceUrl: string): string | null {
  const components = parseMorphUrl(sourceUrl);

  if (!components) {
    return null;
  }

  const vncUrl = createMorphPortUrl(components, 39380);
  vncUrl.pathname = "/vnc.html";
  vncUrl.search = "";
  applyNoVncViewerDefaults(vncUrl, false);
  vncUrl.hash = "";

  return vncUrl.toString();
}

/**
 * Convert a workspace URL to a VNC websocket URL for direct noVNC/RFB connection.
 * This returns a wss:// URL pointing to the /websockify endpoint.
 */
export function toMorphVncWebsocketUrl(sourceUrl: string): string | null {
  const components = parseMorphUrl(sourceUrl);

  if (!components) {
    return null;
  }

  const wsUrl = createMorphPortUrl(components, 39380);
  wsUrl.protocol = "wss:";
  wsUrl.pathname = "/websockify";
  wsUrl.search = "";
  wsUrl.hash = "";

  return wsUrl.toString();
}

/**
 * Convert a generic VNC base URL to a noVNC HTML viewer URL.
 * Works with any VNC URL (PVE LXC, Morph, etc.) by appending /vnc.html and query params.
 *
 * @param vncBaseUrl - The base VNC URL (e.g., https://vnc-201.{PVE_PUBLIC_DOMAIN})
 * @returns The noVNC HTML viewer URL with autoconnect params
 */
export function toVncViewerUrl(vncBaseUrl: string): string | null {
  if (!vncBaseUrl) {
    return null;
  }

  try {
    const url = new URL(vncBaseUrl);
    const normalizedPath = url.pathname.toLowerCase();
    const isViewerUrl =
      normalizedPath.endsWith("/vnc.html") ||
      normalizedPath.endsWith("/viewer.html");

    if (!isViewerUrl) {
      url.pathname = "/vnc.html";
      url.hash = "";
    }

    applyNoVncViewerDefaults(url);

    return url.toString();
  } catch (error) {
    console.debug("[toProxyWorkspaceUrl] Invalid VNC base URL:", vncBaseUrl, error);
    return null;
  }
}

/**
 * Generic port-based URL regex that matches patterns like:
 * - port-39378-pvelxc-1cc7473f.{PVE_PUBLIC_DOMAIN} (PVE LXC)
 * - port-39378-morphvm-abc123.http.cloud.morph.so (Morph)
 */
const GENERIC_PORT_HOST_REGEX = /^port-(\d+)-([^.]+)\.(.+)$/;

/**
 * Convert any workspace URL to a VNC viewer URL.
 * Works with both Morph URLs and PVE LXC URLs (or any port-based URL pattern).
 *
 * Supports patterns like:
 * - https://port-39378-morphvm-abc123.http.cloud.morph.so -> VNC on port 39380
 * - https://port-39378-pvelxc-1cc7473f.{PVE_PUBLIC_DOMAIN} -> VNC on port 39380
 *
 * @param sourceUrl - The workspace/vscode URL
 * @returns The noVNC HTML viewer URL with autoconnect params, or null if URL doesn't match
 */
export function toGenericVncUrl(sourceUrl: string): string | null {
  if (!sourceUrl) {
    return null;
  }

  // Try Morph-specific parser first (for backwards compatibility)
  const morphResult = toMorphVncUrl(sourceUrl);
  if (morphResult) {
    return morphResult;
  }

  // Try generic port-based URL pattern
  try {
    const url = new URL(sourceUrl);
    const match = url.hostname.match(GENERIC_PORT_HOST_REGEX);

    if (!match) {
      return null;
    }

    const [, , hostId, domain] = match;
    // Replace the port in hostname with VNC port (39380)
    url.hostname = `port-39380-${hostId}.${domain}`;
    url.pathname = "/vnc.html";
    url.search = "";
    applyNoVncViewerDefaults(url, false);
    url.hash = "";

    return url.toString();
  } catch (error) {
    console.debug("[toProxyWorkspaceUrl] Failed to generate generic VNC URL:", sourceUrl, error);
    return null;
  }
}

export function resolveBrowserPreviewUrl(input: {
  vncUrl?: string | null;
  workspaceUrl?: string | null;
}): string | null {
  if (input.vncUrl) {
    const browserPreviewUrl = toVncViewerUrl(input.vncUrl);
    if (browserPreviewUrl) {
      return browserPreviewUrl;
    }
  }

  if (input.workspaceUrl) {
    return toGenericVncUrl(input.workspaceUrl);
  }

  return null;
}

/**
 * Resolve a VNC WebSocket URL for direct noVNC/RFB connection.
 * This is the canonical client-side helper for browser preview transport resolution.
 *
 * Priority:
 * 1. If vncUrl is provided:
 *    - If it has ?path=..., extract that as the WebSocket pathname
 *    - Otherwise convert to wss:// with /websockify pathname
 * 2. Fall back to deriving WebSocket URL from workspaceUrl
 *
 * @returns wss:// URL for direct VNC connection, or null if unresolvable
 */
export function resolveBrowserPreviewWebsocketUrl(input: {
  vncUrl?: string | null;
  workspaceUrl?: string | null;
}): string | null {
  if (input.vncUrl) {
    const wsUrl = toVncWebsocketUrlWithPath(input.vncUrl);
    if (wsUrl) {
      return wsUrl;
    }
  }

  if (input.workspaceUrl) {
    return toGenericVncWebsocketUrl(input.workspaceUrl);
  }

  return null;
}

/**
 * Convert a VNC URL to WebSocket URL, handling ?path= query parameter if present.
 * Some VNC providers route via ?path=vnc/websockify instead of direct /websockify.
 */
function toVncWebsocketUrlWithPath(vncBaseUrl: string): string | null {
  if (!vncBaseUrl) {
    return null;
  }

  try {
    const url = new URL(vncBaseUrl);

    // Check for ?path= query parameter (some providers use this for WebSocket routing)
    const pathParam = url.searchParams.get("path");
    if (pathParam) {
      // Convert protocol and use the path param as pathname
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = pathParam.startsWith("/") ? pathParam : `/${pathParam}`;
      url.search = "";
      url.hash = "";
      return url.toString();
    }

    // Check if URL ends in viewer HTML paths - extract base and convert
    const normalizedPath = url.pathname.toLowerCase();
    if (
      normalizedPath.endsWith("/vnc.html") ||
      normalizedPath.endsWith("/viewer.html")
    ) {
      // Replace the HTML viewer path with websockify on same base
      const basePath = url.pathname.slice(0, url.pathname.lastIndexOf("/"));
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = basePath ? `${basePath}/websockify` : "/websockify";
      url.search = "";
      url.hash = "";
      return url.toString();
    }

    // Standard conversion - just set /websockify
    return toVncWebsocketUrl(vncBaseUrl);
  } catch (error) {
    console.debug(
      "[toProxyWorkspaceUrl] Invalid VNC WebSocket URL with path:",
      vncBaseUrl,
      error
    );
    return null;
  }
}

/**
 * Convert a direct VNC base URL to a WebSocket URL for noVNC/RFB connection.
 * Works with any VNC URL (PVE LXC, Morph, etc.) by converting protocol and setting /websockify path.
 *
 * @param vncBaseUrl - The base VNC URL (e.g., https://vnc-201.{PVE_PUBLIC_DOMAIN})
 * @returns The wss:// or ws:// URL pointing to /websockify endpoint, or null if invalid
 */
export function toVncWebsocketUrl(vncBaseUrl: string): string | null {
  if (!vncBaseUrl) {
    return null;
  }

  try {
    const url = new URL(vncBaseUrl);
    // Convert protocol: https -> wss, http -> ws
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/websockify";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (error) {
    console.debug("[toProxyWorkspaceUrl] Invalid VNC WebSocket URL:", vncBaseUrl, error);
    return null;
  }
}

/**
 * Convert any workspace URL to a VNC websocket URL for direct noVNC/RFB connection.
 * Works with both Morph URLs and PVE LXC URLs (or any port-based URL pattern).
 *
 * @param sourceUrl - The workspace/vscode URL
 * @returns The wss:// URL pointing to /websockify endpoint, or null if URL doesn't match
 */
export function toGenericVncWebsocketUrl(sourceUrl: string): string | null {
  if (!sourceUrl) {
    return null;
  }

  // Try Morph-specific parser first (for backwards compatibility)
  const morphResult = toMorphVncWebsocketUrl(sourceUrl);
  if (morphResult) {
    return morphResult;
  }

  // Try generic port-based URL pattern
  try {
    const url = new URL(sourceUrl);
    const match = url.hostname.match(GENERIC_PORT_HOST_REGEX);

    if (!match) {
      return null;
    }

    const [, , hostId, domain] = match;
    // Replace the port in hostname with VNC port (39380)
    url.hostname = `port-39380-${hostId}.${domain}`;
    url.protocol = "wss:";
    url.pathname = "/websockify";
    url.search = "";
    url.hash = "";

    return url.toString();
  } catch (error) {
    console.debug("[toProxyWorkspaceUrl] Failed to generate generic VNC WebSocket URL:", sourceUrl, error);
    return null;
  }
}

export function toMorphXtermBaseUrl(sourceUrl: string): string | null {
  const components = parseMorphUrl(sourceUrl);

  if (!components) {
    return null;
  }

  // Use the direct Morph xterm port host in both web and Electron flows.
  // This avoids relying on legacy upstream alias domains such as *.cmux.app.
  const morphUrl = createMorphPortUrl(components, 39383);
  morphUrl.pathname = "/";
  morphUrl.search = "";
  morphUrl.hash = "";
  return morphUrl.toString();
}
