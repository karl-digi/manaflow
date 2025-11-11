/**
 * Parses a GitHub repository URL and extracts repository information.
 * Supports multiple formats:
 * - Simple: owner/repo
 * - HTTPS: https://github.com/owner/repo or https://github.com/owner/repo.git
 * - SSH: git@github.com:owner/repo.git
 * - PR URLs: https://github.com/owner/repo/pull/123
 * - Branch URLs: https://github.com/owner/repo/tree/branch-name
 *
 * @param input - The GitHub repository URL or identifier
 * @returns Parsed repository information or null if invalid
 */
export function parseGithubRepoUrl(input: string): {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  gitUrl: string;
  prNumber?: number;
  branch?: string;
} | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();

  // Try matching PR URLs: https://github.com/owner/repo/pull/123
  const prMatch = trimmed.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)\/pull\/(\d+)\/?$/i
  );
  if (prMatch) {
    const [, owner, repo, prNumberStr] = prMatch;
    if (owner && repo && prNumberStr) {
      const cleanRepo = repo.replace(/\.git$/, "");
      return {
        owner,
        repo: cleanRepo,
        fullName: `${owner}/${cleanRepo}`,
        url: `https://github.com/${owner}/${cleanRepo}`,
        gitUrl: `https://github.com/${owner}/${cleanRepo}.git`,
        prNumber: parseInt(prNumberStr, 10),
      };
    }
  }

  // Try matching branch URLs: https://github.com/owner/repo/tree/branch-name
  // Branch name can contain slashes, so match everything after /tree/ until end or query/hash
  const branchMatch = trimmed.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)\/tree\/([^?#]+?)\/?$/i
  );
  if (branchMatch) {
    const [, owner, repo, branch] = branchMatch;
    if (owner && repo && branch) {
      const cleanRepo = repo.replace(/\.git$/, "");
      return {
        owner,
        repo: cleanRepo,
        fullName: `${owner}/${cleanRepo}`,
        url: `https://github.com/${owner}/${cleanRepo}`,
        gitUrl: `https://github.com/${owner}/${cleanRepo}.git`,
        branch: decodeURIComponent(branch),
      };
    }
  }

  // Try matching against different patterns
  const simpleMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
  const httpsMatch = trimmed.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/)?$/i
  );
  const sshMatch = trimmed.match(
    /^git@github\.com:([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/i
  );

  const match = simpleMatch || httpsMatch || sshMatch;
  if (!match) {
    return null;
  }

  const [, owner, repo] = match;
  if (!owner || !repo) {
    return null;
  }

  const cleanRepo = repo.replace(/\.git$/, "");
  return {
    owner,
    repo: cleanRepo,
    fullName: `${owner}/${cleanRepo}`,
    url: `https://github.com/${owner}/${cleanRepo}`,
    gitUrl: `https://github.com/${owner}/${cleanRepo}.git`,
  };
}
