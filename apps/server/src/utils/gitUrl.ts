/**
 * Git URL sanitization utilities
 *
 * Handles removal of embedded credentials from HTTP(S) git URLs to prevent
 * stale tokens from persisting in `.git/config`.
 */

/**
 * Check if a git URL has embedded credentials (HTTP/S userinfo).
 */
export function hasEmbeddedCredentials(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return Boolean(parsed.username || parsed.password);
  } catch {
    return false;
  }
}

/**
 * Remove embedded credentials from a git URL.
 * @example
 * sanitizeGitUrl("https://x-access-token:TOKEN@github.com/user/repo.git")
 * // Returns: "https://github.com/user/repo.git"
 */
export function sanitizeGitUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url;
    if (!parsed.username && !parsed.password) return url;

    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Git branch name validation regex.
 * Matches valid git ref names: alphanumeric, hyphens, underscores, periods, slashes.
 * Disallows: shell metacharacters, spaces, double dots, leading/trailing slashes.
 * Based on git-check-ref-format rules.
 */
const GIT_BRANCH_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

/**
 * Validate a git branch name to prevent shell injection.
 * Throws if the branch name contains potentially dangerous characters.
 * @param branch - The branch name to validate
 * @throws Error if branch name is invalid
 */
export function validateBranchName(branch: string): void {
  if (!branch || branch.length === 0) {
    throw new Error("Branch name cannot be empty");
  }
  if (branch.length > 255) {
    throw new Error("Branch name too long (max 255 characters)");
  }
  // Disallow double dots (git restriction and potential path traversal)
  if (branch.includes("..")) {
    throw new Error("Branch name cannot contain '..'");
  }
  // Disallow leading/trailing dots or slashes
  if (branch.startsWith(".") || branch.endsWith(".")) {
    throw new Error("Branch name cannot start or end with '.'");
  }
  if (branch.startsWith("/") || branch.endsWith("/")) {
    throw new Error("Branch name cannot start or end with '/'");
  }
  // Main pattern check: only safe characters
  if (!GIT_BRANCH_PATTERN.test(branch)) {
    throw new Error(
      `Invalid branch name '${branch}': must contain only alphanumeric characters, hyphens, underscores, periods, and forward slashes`
    );
  }
}
