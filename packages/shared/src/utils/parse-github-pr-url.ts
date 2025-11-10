export type GithubPrInfo = {
  owner: string;
  repo: string;
  fullName: string;
  prNumber: number;
  url: string;
};

function normalizeGithubUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;

  try {
    return new URL(withProtocol);
  } catch {
    return null;
  }
}

export function parseGithubPrUrl(input: string): GithubPrInfo | null {
  const url = normalizeGithubUrl(input);
  if (!url) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== "github.com" && hostname !== "www.github.com") {
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
  const repo = segments[1];
  const pullSegment = segments[2];
  const prNumberSegment = segments[3];
  if (!owner || !repo || !pullSegment || !prNumberSegment) {
    return null;
  }

  const pullKeyword = pullSegment.toLowerCase();
  if (pullKeyword !== "pull" && pullKeyword !== "pulls") {
    return null;
  }

  const prNumber = Number.parseInt(prNumberSegment, 10);
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    return null;
  }

  const normalizedRepo = repo.replace(/\.git$/, "");
  return {
    owner,
    repo: normalizedRepo,
    fullName: `${owner}/${normalizedRepo}`,
    prNumber,
    url: `https://github.com/${owner}/${normalizedRepo}/pull/${prNumber}`,
  };
}
