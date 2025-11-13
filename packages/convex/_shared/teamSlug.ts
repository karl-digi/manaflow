export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 48;
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase();
}

export function validateSlug(slug: string): void {
  const normalized = normalizeSlug(slug);
  if (normalized.length < SLUG_MIN_LENGTH || normalized.length > SLUG_MAX_LENGTH) {
    throw new Error("Slug must be 3–48 characters long");
  }
  if (!SLUG_REGEX.test(normalized)) {
    throw new Error(
      "Slug can contain lowercase letters, numbers, and hyphens, and must start/end with a letter or number"
    );
  }
}

export function slugifyTeamName(name: string): string {
  const trimmed = name.trim();
  const emailLocal = extractEmailLocalPart(trimmed);
  const source = emailLocal ?? trimmed;
  return source
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function extractEmailLocalPart(input: string): string | undefined {
  const match = input.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (!match) {
    return undefined;
  }
  const [local] = match[0]?.split("@") ?? [];
  return local ?? undefined;
}

function sanitizeTeamId(teamId: string): string {
  const sanitized = teamId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return sanitized.length > 0 ? sanitized : "team";
}

const encoder = new TextEncoder();

async function digestTeamId(teamId: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", encoder.encode(teamId));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  // Deterministic fallback when SubtleCrypto is unavailable (e.g., bare V8 without crypto)
  let hash = 0;
  for (let i = 0; i < teamId.length; i += 1) {
    hash = (hash * 31 + teamId.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export async function deriveSlugSuffix(teamId: string): Promise<string> {
  const sanitized = sanitizeTeamId(teamId);
  if (sanitized.length >= 3) {
    return sanitized.slice(0, 3);
  }
  const hex = await digestTeamId(teamId);
  return (sanitized + hex).slice(0, 3);
}

export async function buildSlugCandidate(
  teamId: string,
  displayName: string,
  attempt: number,
  suffixOverride?: string,
): Promise<string> {
  const rawBase = slugifyTeamName(displayName);
  const baseFallback = rawBase.length > 0 ? rawBase : "team";
  const suffix = suffixOverride ?? (await deriveSlugSuffix(teamId));
  const attemptPart = attempt > 0 ? attempt.toString(36) : undefined;
  const trailing = attemptPart ? `${suffix}-${attemptPart}` : suffix;

  const hyphenCount = attemptPart ? 2 : 1;
  const maxBaseLength = Math.max(1, SLUG_MAX_LENGTH - trailing.length - hyphenCount);
  let base = baseFallback.slice(0, maxBaseLength);
  if (base.length === 0) {
    base = "team".slice(0, Math.max(1, maxBaseLength));
  }
  if (maxBaseLength >= SLUG_MIN_LENGTH && base.length < SLUG_MIN_LENGTH) {
    const padded = (baseFallback + "team").slice(0, Math.max(SLUG_MIN_LENGTH, maxBaseLength));
    base = padded.length >= SLUG_MIN_LENGTH ? padded : (padded + "team").slice(0, Math.max(SLUG_MIN_LENGTH, maxBaseLength));
  }

  const slug = attemptPart ? `${base}-${suffix}-${attemptPart}` : `${base}-${suffix}`;
  return normalizeSlug(slug).replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

export function extractSlugFromMetadata(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const candidate = (meta as Record<string, unknown>).slug;
  if (typeof candidate !== "string") {
    return undefined;
  }
  const normalized = normalizeSlug(candidate);
  try {
    validateSlug(normalized);
    return normalized;
  } catch (_error) {
    return undefined;
  }
}
