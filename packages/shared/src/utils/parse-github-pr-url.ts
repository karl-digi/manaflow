export type ParsedGithubPullRequestUrl = {
  owner: string;
  repo: string;
  fullName: string;
  number: number;
  url: string;
};

const GITHUB_HOSTNAMES = new Set(["github.com", "www.github.com"]);
const PULL_SEGMENTS = new Set(["pull", "pulls"]);

const normalizeInputToUrl = (input: string): URL | null => {
  try {
    return new URL(input);
  } catch {
    try {
      return new URL(`https://${input}`);
    } catch {
      return null;
    }
  }
};

/**
 * Parses common GitHub PR URL formats like:
 * - https://github.com/owner/repo/pull/123
 * - https://github.com/owner/repo/pull/123/files
 * - github.com/owner/repo/pull/123
 */
export function parseGithubPullRequestUrl(
  input: string
): ParsedGithubPullRequestUrl | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const url = normalizeInputToUrl(trimmed);
  if (!url) return null;

  const hostname = url.hostname.toLowerCase();
  if (!GITHUB_HOSTNAMES.has(hostname)) {
    return null;
  }

  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 4) {
    return null;
  }

  const owner = segments[0];
  const rawRepo = segments[1];
  const pullSegment = segments[2];
  const prNumberSegment = segments[3];
  if (!owner || !rawRepo || !pullSegment || !prNumberSegment) {
    return null;
  }

  if (!PULL_SEGMENTS.has(pullSegment.toLowerCase())) {
    return null;
  }

  const prNumber = Number.parseInt(prNumberSegment, 10);
  if (!Number.isInteger(prNumber)) {
    return null;
  }

  const repo = rawRepo.replace(/\.git$/, "");
  const fullName = `${owner}/${repo}`;

  return {
    owner,
    repo,
    fullName,
    number: prNumber,
    url: `https://github.com/${fullName}/pull/${prNumber}`,
  };
}
