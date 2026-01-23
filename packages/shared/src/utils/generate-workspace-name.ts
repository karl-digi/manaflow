const ALPHABET_SIZE = 26;
const FIRST_LETTER_CHAR_CODE = "a".charCodeAt(0);
const DEFAULT_WORKSPACE_BASE = "workspace";
const DEFAULT_MAX_BASE_LENGTH = 20;

export function workspaceSequenceToName(sequence: number): string {
  if (sequence < 0) {
    throw new Error("Workspace sequence cannot be negative");
  }

  let value = sequence;
  let result = "";

  while (value >= 0) {
    const remainder = value % ALPHABET_SIZE;
    const char = String.fromCharCode(FIRST_LETTER_CHAR_CODE + remainder);
    result = char + result;
    value = Math.floor(value / ALPHABET_SIZE) - 1;
  }

  return result;
}

function sanitizeWorkspaceBaseName(
  baseName: string | null | undefined,
): string {
  if (!baseName) {
    return DEFAULT_WORKSPACE_BASE;
  }

  const trimmed = baseName.trim().toLowerCase();
  if (!trimmed) {
    return DEFAULT_WORKSPACE_BASE;
  }

  const replaced = trimmed.replace(/[^a-z0-9._-]+/g, "-");
  const normalized = replaced.replace(/^-+|-+$/g, "");
  return normalized || DEFAULT_WORKSPACE_BASE;
}

function truncateWorkspaceBaseName(baseName: string, maxLength: number): string {
  if (maxLength <= 0 || baseName.length <= maxLength) {
    return baseName;
  }

  const truncated = baseName.slice(0, maxLength);
  const withoutTrailingSeparators = truncated.replace(/[-_.]+$/g, "");
  return withoutTrailingSeparators || truncated;
}

export function generateWorkspaceName({
  repoName,
  branchName,
  sequence,
  maxBaseLength = DEFAULT_MAX_BASE_LENGTH,
}: {
  repoName?: string | null;
  branchName?: string | null;
  sequence: number;
  maxBaseLength?: number;
}): string {
  const suffix = workspaceSequenceToName(sequence);
  const hasBranchName = Boolean(branchName?.trim());
  const preferredBase = hasBranchName ? branchName : repoName;
  const sanitized = sanitizeWorkspaceBaseName(preferredBase);
  const lengthLimit =
    typeof maxBaseLength === "number" && Number.isFinite(maxBaseLength)
      ? Math.max(1, Math.floor(maxBaseLength))
      : DEFAULT_MAX_BASE_LENGTH;
  const base = hasBranchName
    ? truncateWorkspaceBaseName(sanitized, lengthLimit)
    : sanitized;
  return `${base}-${suffix}`;
}
