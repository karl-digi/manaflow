type CommandFilter = (value: string, search: string, keywords?: string[]) => number;

const EXACT_MATCH_REWARD = 1;
const WORD_BOUNDARY_REWARD = 0.9;
const SYMBOL_BOUNDARY_REWARD = 0.8;
const PARTIAL_SEQUENCE_REWARD = 0.17;
const SKIP_PENALTY = 0.1;
const GAP_DECAY = 0.999;
const CASE_MISMATCH_PENALTY = 0.9999;
const PARTIAL_MATCH_CONTINUATION = 0.99;

const SPECIAL_BOUNDARY = /[[\\/_+.#"@({&]/;
const SPECIAL_BOUNDARY_GLOBAL = /[[\\/_+.#"@({&]/g;
const WORD_BOUNDARY = /[\s-]/;
const WORD_BOUNDARY_GLOBAL = /[\s-]/g;
const DELIMITER_NORMALIZE = /[:/_-]+/g;

const WHITESPACE = /\s+/g;

const clampScore = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const normalizeForComparison = (input: string): string =>
  input.toLowerCase().replace(WORD_BOUNDARY_GLOBAL, " ");

type ScoreMemoKey = `${number},${number}`;

const scoreRecursive = (
  value: string,
  valueLower: string,
  search: string,
  searchLower: string,
  valueIndex: number,
  searchIndex: number,
  memo: Map<ScoreMemoKey, number>,
): number => {
  if (searchIndex === search.length) {
    return valueIndex === value.length
      ? EXACT_MATCH_REWARD
      : PARTIAL_MATCH_CONTINUATION;
  }

  const memoKey = `${valueIndex},${searchIndex}` as ScoreMemoKey;
  const cached = memo.get(memoKey);
  if (cached !== undefined) {
    return cached;
  }

  const searchCharLower = searchLower.charAt(searchIndex);
  let candidateIndex = valueLower.indexOf(searchCharLower, valueIndex);
  let best = 0;

  while (candidateIndex >= 0) {
    let score = scoreRecursive(
      value,
      valueLower,
      search,
      searchLower,
      candidateIndex + 1,
      searchIndex + 1,
      memo,
    );

    if (score > best) {
      if (candidateIndex === valueIndex) {
        score *= EXACT_MATCH_REWARD;
      } else {
        const previousChar = value.charAt(candidateIndex - 1);
        if (SPECIAL_BOUNDARY.test(previousChar)) {
          score *= SYMBOL_BOUNDARY_REWARD;
          if (valueIndex > 0) {
            const matches = value
              .slice(valueIndex, candidateIndex - 1)
              .match(SPECIAL_BOUNDARY_GLOBAL);
            if (matches?.length) {
              score *= Math.pow(GAP_DECAY, matches.length);
            }
          }
        } else if (WORD_BOUNDARY.test(previousChar)) {
          score *= WORD_BOUNDARY_REWARD;
          if (valueIndex > 0) {
            const matches = value
              .slice(valueIndex, candidateIndex - 1)
              .match(WORD_BOUNDARY_GLOBAL);
            if (matches?.length) {
              score *= Math.pow(GAP_DECAY, matches.length);
            }
          }
        } else {
          score *= PARTIAL_SEQUENCE_REWARD;
          if (valueIndex > 0) {
            score *= Math.pow(GAP_DECAY, candidateIndex - valueIndex);
          }
        }

        if (value.charAt(candidateIndex) !== search.charAt(searchIndex)) {
          score *= CASE_MISMATCH_PENALTY;
        }
      }

      const previousLower = candidateIndex > 0 ? valueLower.charAt(candidateIndex - 1) : "";
      const nextSearchCharLower = searchLower.charAt(searchIndex + 1);
      const currentSearchCharLower = searchLower.charAt(searchIndex);

      if (
        (score < SKIP_PENALTY && previousLower === nextSearchCharLower) ||
        (nextSearchCharLower === currentSearchCharLower &&
          previousLower !== currentSearchCharLower)
      ) {
        const skipped = scoreRecursive(
          value,
          valueLower,
          search,
          searchLower,
          candidateIndex + 1,
          searchIndex + 2,
          memo,
        );
        if (skipped * SKIP_PENALTY > score) {
          score = skipped * SKIP_PENALTY;
        }
      }

      if (score > best) {
        best = score;
      }
    }

    candidateIndex = valueLower.indexOf(searchCharLower, candidateIndex + 1);
  }

  memo.set(memoKey, best);
  return best;
};

const computeCommandScore = (
  value: string,
  search: string,
  keywords: readonly string[],
): number => {
  if (!search.trim()) {
    return 1;
  }

  const enrichedValue =
    keywords.length > 0 ? `${value} ${keywords.join(" ")}` : value;

  const valueLower = normalizeForComparison(enrichedValue);
  const searchLower = normalizeForComparison(search);

  if (!searchLower) {
    return 1;
  }

  return scoreRecursive(
    enrichedValue,
    valueLower,
    search,
    searchLower,
    0,
    0,
    new Map(),
  );
};

const buildKeywordVariants = (
  value: string,
  keywords: readonly string[] | undefined,
): string[] => {
  const variants = new Set<string>();

  const addVariant = (raw: string | undefined) => {
    if (!raw) return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    variants.add(trimmed);

    const normalized = trimmed.replace(DELIMITER_NORMALIZE, " ");
    if (normalized !== trimmed) {
      variants.add(normalized);
    }
  };

  addVariant(value.replace(DELIMITER_NORMALIZE, " "));

  if (keywords) {
    for (const keyword of keywords) {
      addVariant(keyword);
    }
  }

  return Array.from(variants);
};

const buildCandidateTokens = (
  value: string,
  keywords: readonly string[],
): string[] => {
  const tokens = new Set<string>();

  const addToken = (raw: string | undefined) => {
    if (!raw) return;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return;

    tokens.add(trimmed);

    const normalized = trimmed.replace(DELIMITER_NORMALIZE, " ");
    tokens.add(normalized);

    for (const fragment of normalized.split(WHITESPACE)) {
      if (fragment) {
        tokens.add(fragment);
      }
    }
  };

  addToken(value);
  for (const keyword of keywords) {
    addToken(keyword);
  }

  return Array.from(tokens);
};

const computePrefixBoost = (
  candidateTokens: readonly string[],
  searchTokens: readonly string[],
): number => {
  if (searchTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  let prefixMatches = 0;
  let wordMatches = 0;

  for (const token of searchTokens) {
    const loweredToken = token.toLowerCase();
    let hasPrefix = false;
    let hasWordMatch = false;

    for (const candidate of candidateTokens) {
      if (!hasPrefix && candidate.startsWith(loweredToken)) {
        hasPrefix = true;
        prefixMatches += 1;
      }

      if (!hasWordMatch) {
        const candidateWords = candidate.split(WHITESPACE);
        if (candidateWords.some((word) => word.startsWith(loweredToken))) {
          hasWordMatch = true;
          wordMatches += 1;
        }
      }

      if (hasPrefix && hasWordMatch) {
        break;
      }
    }
  }

  const prefixBoost = Math.min(0.12, prefixMatches * 0.04);
  const wordBoost = Math.min(
    0.08,
    Math.max(0, wordMatches - prefixMatches) * 0.02,
  );

  return prefixBoost + wordBoost;
};

export const commandPaletteFilter: CommandFilter = (
  value,
  search,
  keywords = [],
) => {
  if (!search) {
    return 1;
  }

  const keywordVariants = buildKeywordVariants(value ?? "", keywords);
  const candidateTokens = buildCandidateTokens(value ?? "", keywordVariants);

  const trimmedSearch = search.trim();
  if (!trimmedSearch) {
    return 1;
  }

  const phraseScore = computeCommandScore(
    value ?? "",
    trimmedSearch,
    keywordVariants,
  );

  const searchTokens = trimmedSearch.split(WHITESPACE).filter(Boolean);
  if (searchTokens.length <= 1) {
    return clampScore(phraseScore);
  }

  let tokenTotal = 0;
  for (const token of searchTokens) {
    const tokenScore = computeCommandScore(value ?? "", token, keywordVariants);
    if (tokenScore <= 0) {
      return 0;
    }
    tokenTotal += tokenScore;
  }

  const averageTokenScore = tokenTotal / searchTokens.length;
  const combinedScore = Math.max(phraseScore, averageTokenScore);
  const boost = computePrefixBoost(candidateTokens, searchTokens);

  return clampScore(Math.min(1, combinedScore + boost));
};

export type { CommandFilter };
