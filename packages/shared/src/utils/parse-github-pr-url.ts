export type ParsedGithubPrUrl = {
  owner: string;
  repo: string;
  number: number;
  fullName: string;
  prUrl: string;
};

const GITHUB_HOST_SUFFIXES = ["github.com", "www.github.com"];

const stripTrailingSlash = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;

export function parseGithubPrUrl(
  value: string | null | undefined
): ParsedGithubPrUrl | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (!GITHUB_HOST_SUFFIXES.includes(hostname)) {
    return null;
  }

  const segments = url.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length < 4) {
    return null;
  }

  const [owner, repo, marker, numberSegment] = segments;
  if (marker.toLowerCase() !== "pull") {
    return null;
  }

  const number = Number.parseInt(numberSegment, 10);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  const normalizedUrl = `https://github.com/${owner}/${repo}/pull/${number}`;

  return {
    owner,
    repo,
    number,
    fullName: `${owner}/${repo}`,
    prUrl: stripTrailingSlash(normalizedUrl),
  };
}
