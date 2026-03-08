/**
 * Extracts the repository base name from either a project full name or repository URL.
 *
 * @param options.projectFullName - Full name in "owner/repo" format (e.g., "anthropics/claude-code")
 * @param options.repoUrl - Git repository URL (e.g., "https://github.com/owner/repo.git")
 * @returns The repository name without owner prefix or .git suffix, or undefined if neither input is valid
 *
 * @example
 * ```ts
 * deriveRepoBaseName({ projectFullName: "anthropics/claude-code" }) // "claude-code"
 * deriveRepoBaseName({ repoUrl: "https://github.com/owner/my-repo.git" }) // "my-repo"
 * ```
 */
export function deriveRepoBaseName({
  projectFullName,
  repoUrl,
}: {
  projectFullName?: string | null;
  repoUrl?: string | null;
}): string | undefined {
  if (projectFullName) {
    const trimmed = projectFullName.trim();
    if (trimmed) {
      const lastSlash = trimmed.lastIndexOf("/");
      if (lastSlash !== -1 && lastSlash + 1 < trimmed.length) {
        return trimmed.slice(lastSlash + 1);
      }
      return trimmed;
    }
  }

  if (repoUrl) {
    const trimmed = repoUrl.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = new URL(trimmed);
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length > 0) {
        const last = segments[segments.length - 1];
        if (last) {
          return last.replace(/\.git$/i, "");
        }
      }
    } catch {
      const fallbackMatch = trimmed.match(/([^/]+)\/([^/]+?)(?:\.git)?$/i);
      if (fallbackMatch) {
        return fallbackMatch[2];
      }
    }
  }

  return undefined;
}
