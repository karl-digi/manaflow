import { isLoopbackHostname } from "@cmux/shared";

/**
 * Regex to match proxy hostname pattern:
 * port-{PORT}-{hostId}.{domain}
 *
 * Examples:
 * - port-5173-pvelxc-30b1cc26.alphasolves.com
 * - port-5173-morphvm-abc123.http.cloud.morph.so
 */
const PROXY_HOST_REGEX = /^port-(\d+)-([^.]+)\.(.+)$/;

export interface ProxyComponents {
  currentPort: number;
  hostId: string;
  domain: string;
}

/**
 * Parse a proxy hostname into its components.
 *
 * @param hostname - The hostname to parse (e.g., port-5173-pvelxc-30b1cc26.alphasolves.com)
 * @returns The parsed components or null if not a proxy hostname
 */
export function parseProxyHostname(hostname: string): ProxyComponents | null {
  const match = hostname.match(PROXY_HOST_REGEX);
  if (!match) return null;
  const [, portStr, hostId, domain] = match;
  if (portStr === undefined) return null;
  const currentPort = Number.parseInt(portStr, 10);
  if (Number.isNaN(currentPort)) return null;
  if (!hostId || !domain) return null;
  return { currentPort, hostId, domain };
}

/**
 * Build a proxy origin URL for a given target port.
 *
 * @param components - The hostId and domain from parseProxyHostname
 * @param targetPort - The port number to build the origin for
 * @returns The proxy origin URL (e.g., https://port-9776-pvelxc-30b1cc26.alphasolves.com)
 */
export function buildProxyOrigin(
  components: Pick<ProxyComponents, "hostId" | "domain">,
  targetPort: number,
): string {
  return `https://port-${targetPort}-${components.hostId}.${components.domain}`;
}

/**
 * Derive the correct service URL based on the current window location.
 *
 * If the page is accessed through a proxy URL pattern (e.g., port-5173-pvelxc-xxx.alphasolves.com),
 * this function will return a proxy URL for the target port. Otherwise, it returns the fallback URL.
 *
 * @param targetPort - The port number of the target service
 * @param fallbackUrl - The URL to use if not accessed through a proxy
 * @returns The derived service URL
 */
export function deriveProxyServiceUrl(
  targetPort: number,
  fallbackUrl: string,
): string {
  if (typeof window === "undefined") return fallbackUrl;

  // Only derive proxy URL if fallback points to localhost
  try {
    const parsed = new URL(fallbackUrl);
    if (!isLoopbackHostname(parsed.hostname)) return fallbackUrl;
  } catch {
    // Invalid fallback URL: return as-is instead of deriving a proxy URL.
    return fallbackUrl;
  }

  const components = parseProxyHostname(window.location.hostname);
  if (!components) return fallbackUrl;

  return buildProxyOrigin(components, targetPort);
}
