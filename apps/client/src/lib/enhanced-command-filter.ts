/**
 * Enhanced filtering and scoring algorithm for cmdk command palette
 *
 * Improvements over default command-score:
 * 1. Strong prefix matching bonus - exact starts get highest priority
 * 2. Word boundary detection - matches after spaces/special chars rank higher
 * 3. Case-sensitive exact match bonus
 * 4. Consecutive character bonus - reduces penalty for character gaps
 * 5. Recency scoring integration
 */

interface FilterOptions {
  /**
   * Optional recency scores map where keys are item values and values are timestamps
   * More recent items get a score boost
   */
  recencyScores?: Map<string, number>;

  /**
   * How much to boost recent items (0-1, default 0.15)
   * Higher = more weight to recently accessed items
   */
  recencyWeight?: number;
}

/**
 * Normalizes a string for comparison by converting to lowercase and removing extra whitespace
 */
function normalizeString(str: string): string {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Checks if a character is a word boundary
 */
function isWordBoundary(char: string): boolean {
  return /[\s\-_./\\]/.test(char);
}

/**
 * Calculate the fuzzy match score between search query and target string
 * Returns a score between 0 (no match) and 1 (perfect match)
 */
function calculateFuzzyScore(search: string, target: string, keywords: string[]): number {
  const normalizedSearch = normalizeString(search);
  const normalizedTarget = normalizeString(target);

  if (normalizedSearch.length === 0) {
    return 1; // Empty search matches everything
  }

  // Check all possible match targets (main value + keywords)
  const allTargets = [normalizedTarget, ...keywords.map(k => normalizeString(k))];
  let bestScore = 0;

  for (const testTarget of allTargets) {
    const score = scoreMatch(normalizedSearch, testTarget, target);
    bestScore = Math.max(bestScore, score);

    // Early exit if we found a perfect or near-perfect match
    if (bestScore > 0.95) {
      return bestScore;
    }
  }

  return bestScore;
}

/**
 * Score a single match between search and target
 */
function scoreMatch(search: string, target: string, originalTarget: string): number {
  // Perfect match
  if (search === target) {
    return 1.0;
  }

  // Prefix match - very high score
  if (target.startsWith(search)) {
    return 0.95;
  }

  // Case-sensitive exact substring match bonus
  if (originalTarget.includes(search)) {
    const startIndex = originalTarget.indexOf(search);
    // Higher score if it starts at the beginning or after a word boundary
    if (startIndex === 0) {
      return 0.92;
    } else if (startIndex > 0 && isWordBoundary(originalTarget[startIndex - 1])) {
      return 0.88;
    }
    return 0.80;
  }

  // Fuzzy match - find all search characters in order
  let searchIdx = 0;
  let targetIdx = 0;
  let score = 0;
  let consecutiveMatches = 0;
  const matchPositions: number[] = [];

  while (searchIdx < search.length && targetIdx < target.length) {
    if (search[searchIdx] === target[targetIdx]) {
      matchPositions.push(targetIdx);

      // Bonus for consecutive matches
      if (matchPositions.length > 1 &&
          matchPositions[matchPositions.length - 1] === matchPositions[matchPositions.length - 2] + 1) {
        consecutiveMatches++;
      } else {
        consecutiveMatches = 0;
      }

      // Position-based scoring
      let positionScore = 1.0;

      // First match at start gets highest bonus
      if (searchIdx === 0 && targetIdx === 0) {
        positionScore = 1.0;
      }
      // Match after word boundary gets bonus
      else if (targetIdx > 0 && isWordBoundary(target[targetIdx - 1])) {
        positionScore = 0.9;
      }
      // Match in middle of word
      else {
        positionScore = 0.3;
      }

      // Consecutive match bonus (reduces gap penalty)
      const consecutiveBonus = Math.min(consecutiveMatches * 0.1, 0.3);
      positionScore += consecutiveBonus;

      score += positionScore;
      searchIdx++;
    }
    targetIdx++;
  }

  // If we didn't match all search characters, it's not a match
  if (searchIdx < search.length) {
    return 0;
  }

  // Normalize score based on search length
  score = score / search.length;

  // Apply penalty for length difference (prefer shorter matches)
  const lengthRatio = search.length / target.length;
  score *= 0.5 + (lengthRatio * 0.5); // 50% base + up to 50% based on length similarity

  return Math.min(score, 0.75); // Cap fuzzy matches below prefix matches
}

/**
 * Calculate recency boost based on timestamp
 * More recent = higher boost
 */
function calculateRecencyBoost(
  value: string,
  recencyScores: Map<string, number> | undefined,
  recencyWeight: number
): number {
  if (!recencyScores || recencyScores.size === 0) {
    return 0;
  }

  const timestamp = recencyScores.get(value);
  if (!timestamp) {
    return 0;
  }

  // Calculate age in milliseconds
  const now = Date.now();
  const age = now - timestamp;

  // Decay function: full boost for items < 1 hour old, decays over 7 days
  const oneHour = 60 * 60 * 1000;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  let boost = 0;
  if (age < oneHour) {
    boost = 1.0;
  } else if (age < sevenDays) {
    // Linear decay from 1.0 to 0.1 over 7 days
    boost = 1.0 - ((age - oneHour) / (sevenDays - oneHour)) * 0.9;
  } else {
    boost = 0.1; // Minimum boost for old items
  }

  return boost * recencyWeight;
}

/**
 * Enhanced filter function for cmdk
 * Compatible with cmdk's filter prop: (value: string, search: string, keywords?: string[]) => number
 */
export function enhancedFilter(
  value: string,
  search: string,
  keywords?: string[],
  options?: FilterOptions
): number {
  const keywordArray = keywords ?? [];
  const recencyWeight = options?.recencyWeight ?? 0.15;

  // Calculate base fuzzy score
  let score = calculateFuzzyScore(search, value, keywordArray);

  // Add recency boost if available
  if (options?.recencyScores) {
    const recencyBoost = calculateRecencyBoost(value, options.recencyScores, recencyWeight);
    score = Math.min(score + recencyBoost, 1.0);
  }

  return score;
}

/**
 * Create a filter function with bound options
 * Useful for passing to cmdk's filter prop
 */
export function createEnhancedFilter(options?: FilterOptions) {
  return (value: string, search: string, keywords?: string[]) =>
    enhancedFilter(value, search, keywords, options);
}
