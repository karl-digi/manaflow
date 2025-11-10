/**
 * Parses a GitHub Pull Request identifier into structured information.
 * Supports:
 *   - Full URLs: https://github.com/owner/repo/pull/123
 *   - URLs with extra path/query segments (e.g. /files, ?diff=split)
 *   - URLs without protocol (github.com/owner/repo/pull/123)
 *   - Short form: owner/repo#123
 */
export interface ParsedGithubPr {
  owner: string;
  repo: string;
  fullName: string;
  number: number;
  url: string;
  shortRef: string;
}

const normalizeRepo = (value: string): string => value.replace(/\.git$/i, "");

const buildParsedPr = (
  owner: string,
  repo: string,
  number: string,
): ParsedGithubPr | null => {
  const cleanOwner = owner?.trim();
  const cleanRepo = normalizeRepo(repo?.trim());
  const intNumber = Number.parseInt(number ?? "", 10);
  if (
    !cleanOwner ||
    !cleanRepo ||
    !Number.isFinite(intNumber) ||
    intNumber <= 0
  ) {
    return null;
  }
  const canonicalUrl = `https://github.com/${cleanOwner}/${cleanRepo}/pull/${intNumber}`;
  return {
    owner: cleanOwner,
    repo: cleanRepo,
    fullName: `${cleanOwner}/${cleanRepo}`,
    number: intNumber,
    url: canonicalUrl,
    shortRef: `${cleanOwner}/${cleanRepo}#${intNumber}`,
  };
};

export function parseGithubPrUrl(input: string | null | undefined): ParsedGithubPr | null {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const patterns: RegExp[] = [
    /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/pulls?\/(\d+)(?:[/?#].*)?$/i,
    /^github\.com\/([\w.-]+)\/([\w.-]+)\/pulls?\/(\d+)(?:[/?#].*)?$/i,
    /^([\w.-]+)\/([\w.-]+)#(\d+)$/i,
    /^https?:\/\/api\.github\.com\/repos\/([\w.-]+)\/([\w.-]+)\/pulls\/(\d+)(?:[/?#].*)?$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return buildParsedPr(match[1], match[2], match[3]);
    }
  }

  return null;
}
