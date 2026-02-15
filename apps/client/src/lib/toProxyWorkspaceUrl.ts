import {
  LOCAL_VSCODE_PLACEHOLDER_HOST,
  isLoopbackHostname,
} from "@cmux/shared";
import { env } from "../client-env";

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
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
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

  const searchParams = new URLSearchParams();
  searchParams.set("autoconnect", "1");
  searchParams.set("resize", "scale");
  searchParams.set("reconnect", "0");
  vncUrl.search = `?${searchParams.toString()}`;
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
    url.pathname = "/vnc.html";

    const searchParams = new URLSearchParams();
    searchParams.set("autoconnect", "1");
    searchParams.set("resize", "scale");
    searchParams.set("reconnect", "0");
    url.search = `?${searchParams.toString()}`;
    url.hash = "";

    return url.toString();
  } catch {
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

    const searchParams = new URLSearchParams();
    searchParams.set("autoconnect", "1");
    searchParams.set("resize", "scale");
    searchParams.set("reconnect", "0");
    url.search = `?${searchParams.toString()}`;
    url.hash = "";

    return url.toString();
  } catch {
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
  } catch {
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
  } catch {
    return null;
  }
}

export function toMorphXtermBaseUrl(sourceUrl: string): string | null {
  const components = parseMorphUrl(sourceUrl);

  if (!components) {
    return null;
  }

  // In web mode, use the Morph URLs directly without proxy rewriting
  if (env.NEXT_PUBLIC_WEB_MODE) {
    const morphUrl = createMorphPortUrl(components, 39383);
    morphUrl.pathname = "/";
    morphUrl.search = "";
    morphUrl.hash = "";
    return morphUrl.toString();
  }

  const scope = "base";
  const proxiedUrl = new URL(components.url.toString());
  proxiedUrl.hostname = `cmux-${components.morphId}-${scope}-39383.cmux.app`;
  proxiedUrl.port = "";
  proxiedUrl.pathname = "/";
  proxiedUrl.search = "";
  proxiedUrl.hash = "";

  return proxiedUrl.toString();
}
