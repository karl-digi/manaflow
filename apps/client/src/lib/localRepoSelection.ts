const LOCAL_PREFIX = "local::";
const WINDOWS_DRIVE_REGEX = /^[a-zA-Z]:[\\/]/;

export function encodeLocalRepoValue(path: string): string {
  return `${LOCAL_PREFIX}${path}`;
}

export function decodeLocalRepoValue(
  value?: string | null
): string | null {
  if (!value) {
    return null;
  }
  return value.startsWith(LOCAL_PREFIX)
    ? value.slice(LOCAL_PREFIX.length)
    : null;
}

export function isLikelyPathInput(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }
  if (
    trimmed.startsWith("~") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    trimmed.startsWith(".")
  ) {
    return true;
  }
  if (WINDOWS_DRIVE_REGEX.test(trimmed)) {
    return true;
  }
  return trimmed.includes("/") || trimmed.includes("\\");
}
