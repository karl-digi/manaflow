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
