export type GithubWorkspaceTarget =
  | {
      type: "repo";
      owner: string;
      repo: string;
      fullName: string;
      repoUrl: string;
      source: string;
    }
  | {
      type: "branch";
      owner: string;
      repo: string;
      fullName: string;
      repoUrl: string;
      branch: string;
      source: string;
    }
  | {
      type: "pull-request";
      owner: string;
      repo: string;
      fullName: string;
      repoUrl: string;
      pullRequestNumber: number;
      pullRequestUrl: string;
      source: string;
    };

const GITHUB_HOST = "github.com";

const normalizeGithubValue = (value: string): string => {
  if (value.startsWith("www.")) {
    return value.slice(4).toLowerCase();
  }
  return value.toLowerCase();
};

const stripGitSuffix = (value: string): string => {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
};

const decodePathSegment = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const buildBaseTarget = ({
  owner,
  repo,
  source,
}: {
  owner: string;
  repo: string;
  source: string;
}) => {
  const cleanOwner = decodePathSegment(owner);
  const cleanRepo = stripGitSuffix(decodePathSegment(repo));
  const fullName = `${cleanOwner}/${cleanRepo}`;
  return {
    owner: cleanOwner,
    repo: cleanRepo,
    fullName,
    repoUrl: `https://${GITHUB_HOST}/${fullName}.git`,
    source,
  };
};

const parseSegmentsTarget = (
  segments: string[],
  source: string
): GithubWorkspaceTarget | null => {
  if (segments.length < 2) {
    return null;
  }

  const base = buildBaseTarget({
    owner: segments[0]!,
    repo: segments[1]!,
    source,
  });

  if (segments.length === 2) {
    return {
      type: "repo",
      ...base,
    };
  }

  const mode = segments[2]?.toLowerCase();
  if (!mode) {
    return {
      type: "repo",
      ...base,
    };
  }

  if (mode === "pull" || mode === "pulls") {
    const prSegment = segments[3];
    if (!prSegment) {
      return null;
    }
    const prNumber = Number.parseInt(prSegment, 10);
    if (!Number.isFinite(prNumber)) {
      return null;
    }
    return {
      type: "pull-request",
      ...base,
      pullRequestNumber: prNumber,
      pullRequestUrl: `https://${GITHUB_HOST}/${base.fullName}/pull/${prNumber}`,
    };
  }

  if (mode === "tree" || mode === "blob") {
    const branchSegments = segments.slice(3);
    if (branchSegments.length === 0) {
      return null;
    }
    const branch = branchSegments.map(decodePathSegment).join("/");
    if (!branch) {
      return null;
    }
    return {
      type: "branch",
      ...base,
      branch,
    };
  }

  return {
    type: "repo",
    ...base,
  };
};

const parseUrlTarget = (input: string): GithubWorkspaceTarget | null => {
  let candidate = input.trim();
  if (!candidate) {
    return null;
  }

  if (
    candidate.startsWith("github.com/") ||
    candidate.startsWith("www.github.com/")
  ) {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  const host = normalizeGithubValue(url.hostname);
  if (host !== GITHUB_HOST) {
    return null;
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  const segments =
    pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean) ?? [];

  return parseSegmentsTarget(segments, input);
};

export const parseGithubWorkspaceTarget = (
  input: string
): GithubWorkspaceTarget | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const urlTarget = parseUrlTarget(trimmed);
  if (urlTarget) {
    return urlTarget;
  }

  // Support simple owner/repo strings
  const simpleSegments = trimmed.split("/").filter(Boolean);
  if (simpleSegments.length === 2) {
    return parseSegmentsTarget(simpleSegments, trimmed);
  }

  return null;
};
