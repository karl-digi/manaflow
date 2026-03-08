/**
 * Shared git utilities for Convex functions
 */

/**
 * Normalize a repository full name (owner/repo format).
 * Trims whitespace, removes .git suffix, and lowercases.
 * Throws if the format is invalid.
 *
 * @param value - Repository name in "owner/name" format
 * @returns Normalized repository name
 * @throws Error if the format is invalid
 */
export function normalizeRepoFullName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes("/")) {
    throw new Error("repoFullName must be in the form owner/name");
  }
  return trimmed.replace(/\.git$/i, "").toLowerCase();
}
