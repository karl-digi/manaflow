import { isLocalHostname } from "./is-local-host";

export function normalizeOrigin(rawOrigin: string): string {
  const trimmed = rawOrigin?.trim();
  if (!trimmed) return rawOrigin;
  try {
    const url = new URL(trimmed);
    const isLocal = isLocalHostname(url.hostname);
    if (url.protocol === "http:" && !isLocal) {
      url.protocol = "https:";
    }
    return url.origin;
  } catch (error) {
    console.warn(
      `[normalizeOrigin] Unable to parse origin: ${rawOrigin}`,
      error instanceof Error ? error.message : error
    );
    return trimmed;
  }
}
