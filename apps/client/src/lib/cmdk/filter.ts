import { defaultFilter } from "cmdk";

type CommandFilter = (value: string, search: string, keywords?: string[]) => number;

const DIACRITIC_REGEX = /[\u0300-\u036f]/g;
const NON_ALPHANUMERIC_REGEX = /[^a-z0-9]+/g;

const normalizeForSearch = (input: string): string => {
  return input
    .normalize("NFKD")
    .replace(DIACRITIC_REGEX, "")
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_REGEX, " ")
    .trim();
};

const tokenize = (input: string): string[] => {
  const normalized = normalizeForSearch(input);
  if (normalized.length === 0) return [];
  return normalized.split(" ").filter(Boolean);
};

const buildHaystackTokens = (value: string, keywords: string[] | undefined): string[] => {
  const combined = [value, ...(keywords ?? [])].filter((part) => part && part.length > 0);
  const tokens = tokenize(combined.join(" "));
  if (tokens.length > 1) {
    const initials = tokens.map((token) => token.charAt(0)).join("");
    if (initials.length > 0) tokens.push(initials);
  }
  return tokens;
};

const clampScore = (score: number): number => {
  if (Number.isNaN(score)) return 0;
  if (score <= 0) return 0;
  if (score >= 1) return 1;
  return score;
};

export const commandSearchFilter: CommandFilter = (value, search, keywords) => {
  if (!search || search.trim().length === 0) {
    return 1;
  }

  const baseScore = defaultFilter(value, search, keywords);
  if (baseScore <= 0) {
    return 0;
  }

  const searchTokens = tokenize(search);
  if (searchTokens.length === 0) {
    return clampScore(baseScore);
  }

  const haystackTokens = buildHaystackTokens(value, keywords);
  if (haystackTokens.length === 0) {
    return 0;
  }

  let coverageSum = 0;
  let strongMatches = 0;
  let missingTokens = 0;

  for (const token of searchTokens) {
    let bestMatch = 0;
    for (const hay of haystackTokens) {
      if (hay === token) {
        bestMatch = 1;
        break;
      }
      if (hay.startsWith(token)) {
        bestMatch = Math.max(bestMatch, 0.85);
      } else if (hay.includes(token)) {
        bestMatch = Math.max(bestMatch, 0.6);
      }
    }

    if (bestMatch === 0) {
      missingTokens += 1;
    } else {
      coverageSum += bestMatch;
      if (bestMatch >= 1) {
        strongMatches += 1;
      } else if (bestMatch >= 0.85) {
        strongMatches += 0.5;
      }
    }
  }

  if (missingTokens === searchTokens.length) {
    return 0;
  }

  const coverage = coverageSum / searchTokens.length;
  const strongCoverage = Math.min(1, strongMatches / searchTokens.length);

  let score = baseScore * (0.4 + 0.6 * coverage) + 0.15 * strongCoverage;

  if (missingTokens > 0) {
    const penalty = Math.pow(0.75, missingTokens);
    score *= penalty;
  }

  if (coverage < 0.15) {
    score *= coverage / 0.15;
  }

  return clampScore(score);
};
