/**
 * Parses a GitHub Pull Request URL and extracts relevant information
 *
 * Supported formats:
 * - https://github.com/owner/repo/pull/123
 * - github.com/owner/repo/pull/123
 * - owner/repo/pull/123
 * - owner/repo#123
 */

export interface GitHubPRInfo {
  owner: string;
  repo: string;
  fullName: string;
  prNumber: number;
  url: string;
}

export function parseGithubPrUrl(input: string): GitHubPRInfo | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();

  // Pattern 1: Full URL - https://github.com/owner/repo/pull/123
  const fullUrlPattern = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/i;
  const fullUrlMatch = trimmed.match(fullUrlPattern);

  if (fullUrlMatch) {
    const [, owner, repo, prNumber] = fullUrlMatch;
    return {
      owner,
      repo: repo.replace(/\.git$/, ''),
      fullName: `${owner}/${repo.replace(/\.git$/, '')}`,
      prNumber: parseInt(prNumber, 10),
      url: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}/pull/${prNumber}`,
    };
  }

  // Pattern 2: Short format - owner/repo/pull/123
  const shortPattern = /^([^\/]+)\/([^\/]+)\/pull\/(\d+)$/;
  const shortMatch = trimmed.match(shortPattern);

  if (shortMatch) {
    const [, owner, repo, prNumber] = shortMatch;
    return {
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      prNumber: parseInt(prNumber, 10),
      url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
    };
  }

  // Pattern 3: Issue-style format - owner/repo#123
  const issueStylePattern = /^([^\/]+)\/([^#]+)#(\d+)$/;
  const issueStyleMatch = trimmed.match(issueStylePattern);

  if (issueStyleMatch) {
    const [, owner, repo, prNumber] = issueStyleMatch;
    return {
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      prNumber: parseInt(prNumber, 10),
      url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
    };
  }

  return null;
}

/**
 * Checks if a given string looks like a GitHub PR URL
 */
export function isGithubPrUrl(input: string): boolean {
  return parseGithubPrUrl(input) !== null;
}
