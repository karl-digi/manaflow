export interface ParsedGithubPrUrl {
  owner: string;
  repo: string;
  repoFullName: string;
  prNumber: number;
  prUrl: string;
}

const SCHEME_REGEX = /^[a-z][a-z0-9+\-.]*:\/\//i;

/**
 * Attempts to parse a GitHub pull request URL.
 *
 * Supports standard URLs such as:
 *   https://github.com/org/repo/pull/123
 *   https://github.com/org/repo/pull/123/files
 *
 * Returns `null` if the input cannot be parsed.
 */
export const parseGithubPrUrl = (
  input: string | null | undefined,
): ParsedGithubPrUrl | null => {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = SCHEME_REGEX.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== "github.com" && hostname !== "www.github.com") {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 4) {
    return null;
  }

  const [owner, repo, pullLiteral, prNumberSegment] = segments;
  if (pullLiteral !== "pull" && pullLiteral !== "pulls") {
    return null;
  }

  const prNumber = Number.parseInt(prNumberSegment, 10);
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    return null;
  }

  const repoFullName = `${owner}/${repo}`;
  const normalizedUrl = `https://github.com/${repoFullName}/pull/${prNumber}`;

  return {
    owner,
    repo,
    repoFullName,
    prNumber,
    prUrl: normalizedUrl,
  };
};
