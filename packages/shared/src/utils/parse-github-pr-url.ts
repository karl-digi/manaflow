/**
 * Parses a GitHub Pull Request URL and extracts PR information.
 * Supports formats like:
 * - https://github.com/owner/repo/pull/123
 * - https://github.com/owner/repo/pull/123/files
 * - https://github.com/owner/repo/pull/123#issuecomment-...
 *
 * @param input - The GitHub PR URL
 * @returns Parsed PR information or null if invalid
 */
export function parseGithubPrUrl(input: string): {
  owner: string;
  repo: string;
  fullName: string;
  prNumber: number;
  url: string;
  repoUrl: string;
  gitUrl: string;
} | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();

  // Match GitHub PR URLs
  const prMatch = trimmed.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)\/pull\/(\d+)/i
  );

  if (!prMatch) {
    return null;
  }

  const [, owner, repo, prNumberStr] = prMatch;
  if (!owner || !repo || !prNumberStr) {
    return null;
  }

  const prNumber = parseInt(prNumberStr, 10);
  if (isNaN(prNumber) || prNumber <= 0) {
    return null;
  }

  const cleanRepo = repo.replace(/\.git$/, "");
  return {
    owner,
    repo: cleanRepo,
    fullName: `${owner}/${cleanRepo}`,
    prNumber,
    url: `https://github.com/${owner}/${cleanRepo}/pull/${prNumber}`,
    repoUrl: `https://github.com/${owner}/${cleanRepo}`,
    gitUrl: `https://github.com/${owner}/${cleanRepo}.git`,
  };
}
