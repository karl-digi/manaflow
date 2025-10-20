const GIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const SPECIAL_GIT_REFS = new Set([
  "HEAD",
  "FETCH_HEAD",
  "MERGE_HEAD",
  "ORIG_HEAD",
]);

export function refWithOrigin(ref: string): string {
  if (ref.startsWith("origin/")) {
    return ref;
  }
  return `origin/${ref}`;
}

export function normalizeGitRef(ref?: string | null): string {
  if (!ref) {
    return "";
  }

  const trimmed = ref.trim();
  if (!trimmed) {
    return "";
  }

  const deduped = trimmed.replace(/^origin\/(origin\/)+/, "origin/");
  if (deduped.startsWith("refs/")) {
    return deduped;
  }
  if (deduped.startsWith("origin/")) {
    return deduped;
  }
  if (SPECIAL_GIT_REFS.has(deduped)) {
    return deduped;
  }
  if (GIT_SHA_PATTERN.test(deduped)) {
    return deduped;
  }
  if (deduped.includes("@{")) {
    return deduped;
  }

  return refWithOrigin(deduped);
}
