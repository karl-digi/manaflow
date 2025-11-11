/**
 * Parses a GitHub URL and extracts repository and reference information.
 * Supports multiple formats:
 * - Pull Request: https://github.com/owner/repo/pull/123
 * - Branch: https://github.com/owner/repo/tree/branch-name
 * - Repo: https://github.com/owner/repo (defaults to main)
 * - Simple: owner/repo
 *
 * @param input - The GitHub URL or identifier
 * @returns Parsed GitHub information or null if invalid
 */
export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  gitUrl: string;
  type: "pr" | "branch" | "repo";
  prNumber?: number;
  branch?: string;
}

export function parseGitHubUrl(input: string): ParsedGitHubUrl | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();

  // Try matching PR URL: https://github.com/owner/repo/pull/123
  const prMatch = trimmed.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)\/pull\/(\d+)(?:\/.*)?$/i
  );
  if (prMatch) {
    const [, owner, repo, prNumber] = prMatch;
    if (!owner || !repo || !prNumber) return null;

    const cleanRepo = repo.replace(/\.git$/, "");
    return {
      owner,
      repo: cleanRepo,
      fullName: `${owner}/${cleanRepo}`,
      url: `https://github.com/${owner}/${cleanRepo}`,
      gitUrl: `https://github.com/${owner}/${cleanRepo}.git`,
      type: "pr",
      prNumber: Number.parseInt(prNumber, 10),
    };
  }

  // Try matching branch URL: https://github.com/owner/repo/tree/branch-name
  const branchMatch = trimmed.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)\/tree\/([^/?#]+)(?:\/.*)?$/i
  );
  if (branchMatch) {
    const [, owner, repo, branch] = branchMatch;
    if (!owner || !repo || !branch) return null;

    const cleanRepo = repo.replace(/\.git$/, "");
    return {
      owner,
      repo: cleanRepo,
      fullName: `${owner}/${cleanRepo}`,
      url: `https://github.com/${owner}/${cleanRepo}`,
      gitUrl: `https://github.com/${owner}/${cleanRepo}.git`,
      type: "branch",
      branch: decodeURIComponent(branch),
    };
  }

  // Try matching repo URL: https://github.com/owner/repo
  const repoMatch = trimmed.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/)?$/i
  );
  if (repoMatch) {
    const [, owner, repo] = repoMatch;
    if (!owner || !repo) return null;

    const cleanRepo = repo.replace(/\.git$/, "");
    return {
      owner,
      repo: cleanRepo,
      fullName: `${owner}/${cleanRepo}`,
      url: `https://github.com/${owner}/${cleanRepo}`,
      gitUrl: `https://github.com/${owner}/${cleanRepo}.git`,
      type: "repo",
    };
  }

  // Try matching simple format: owner/repo
  const simpleMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (simpleMatch) {
    const [, owner, repo] = simpleMatch;
    if (!owner || !repo) return null;

    const cleanRepo = repo.replace(/\.git$/, "");
    return {
      owner,
      repo: cleanRepo,
      fullName: `${owner}/${cleanRepo}`,
      url: `https://github.com/${owner}/${cleanRepo}`,
      gitUrl: `https://github.com/${owner}/${cleanRepo}.git`,
      type: "repo",
    };
  }

  return null;
}
