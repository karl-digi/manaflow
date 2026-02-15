const PROXY_HOSTNAME_REGEX =
  /^port-(\d+)-([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.([a-z0-9.-]+)$/i;

export const DEFAULT_TRUSTED_PROXY_DOMAINS = [
  "cmux.sh",
  "cmux.dev",
  "cmux.local",
  "cmux.localhost",
  "cmux.app",
  "autobuild.app",
  "vm.freestyle.sh",
  "http.cloud.morph.so",
] as const;

export interface ParsedProxyHostname {
  port: number;
  hostId: string;
  domain: string;
}

function normalizeDomainCandidate(candidate: string): string | null {
  let value = candidate.trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (value.includes("://")) {
    try {
      value = new URL(value).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  if (value.startsWith(".")) {
    value = value.slice(1);
  }
  if (value.endsWith(".")) {
    value = value.slice(0, -1);
  }

  if (!value || value.includes("/") || value.includes(" ") || value.includes("..")) {
    return null;
  }

  return value;
}

export function buildTrustedProxyDomainSet(
  additionalDomains: Iterable<string | null | undefined> = [],
): Set<string> {
  const domains = new Set<string>(DEFAULT_TRUSTED_PROXY_DOMAINS);

  for (const candidate of additionalDomains) {
    if (!candidate) {
      continue;
    }
    const normalized = normalizeDomainCandidate(candidate);
    if (normalized) {
      domains.add(normalized);
    }
  }

  return domains;
}

export function parseProxyHostname(hostname: string): ParsedProxyHostname | null {
  const normalizedHostname = hostname.toLowerCase();
  const match = normalizedHostname.match(PROXY_HOSTNAME_REGEX);
  if (!match) {
    return null;
  }

  const portValue = match[1];
  const hostId = match[2];
  const domain = match[3];
  if (!portValue || !hostId || !domain) {
    return null;
  }

  const port = Number.parseInt(portValue, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return null;
  }

  return { port, hostId, domain };
}

export function isTrustedProxyHostname(
  hostname: string,
  trustedDomains: ReadonlySet<string>,
): boolean {
  const parsed = parseProxyHostname(hostname);
  if (!parsed) {
    return false;
  }

  return trustedDomains.has(parsed.domain);
}
