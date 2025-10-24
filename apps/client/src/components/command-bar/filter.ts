/**
 * Enhanced command filtering algorithm for cmdk
 *
 * Improvements over default command-score:
 * - Acronym matching (e.g., "npr" matches "New Pull Request")
 * - Better prefix matching with higher scores
 * - Improved keyword matching
 * - Case-insensitive matching with proper scoring
 * - Better handling of multi-word queries
 */

// Scoring constants
const SCORE_PERFECT_MATCH = 1.0;
const SCORE_PREFIX_MATCH = 0.95;
const SCORE_ACRONYM_MATCH = 0.9;
const SCORE_WORD_START_MATCH = 0.85;
const SCORE_KEYWORD_MATCH = 0.8;
const SCORE_CONTAINS_MATCH = 0.7;
const SCORE_FUZZY_MATCH = 0.5;
const SCORE_NO_MATCH = 0;

// Penalty constants
const DISTANCE_PENALTY = 0.995; // Per-character distance penalty

/**
 * Normalize text for matching: lowercase, remove extra spaces
 */
function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Check if search matches word starts (acronym matching)
 * Example: "npr" matches "New Pull Request"
 */
function matchesAcronym(value: string, search: string): boolean {
  const words = value.split(/[\s\-_/]+/).filter(w => w.length > 0);
  const searchChars = search.split('');

  if (searchChars.length > words.length) return false;

  let searchIdx = 0;
  for (let i = 0; i < words.length && searchIdx < searchChars.length; i++) {
    if (words[i][0] === searchChars[searchIdx]) {
      searchIdx++;
    }
  }

  return searchIdx === searchChars.length;
}

/**
 * Check if search matches any word start in value
 */
function matchesWordStart(value: string, search: string): boolean {
  const words = value.split(/[\s\-_/]+/);
  return words.some(word => word.startsWith(search));
}

/**
 * Calculate fuzzy match score using dynamic programming
 * Similar to command-score but with adjusted penalties
 */
function fuzzyMatchScore(value: string, search: string): number {
  if (search.length === 0) return SCORE_PERFECT_MATCH;
  if (value.length === 0) return SCORE_NO_MATCH;

  const valueLen = value.length;
  const searchLen = search.length;

  // DP table: dp[i][j] = best score matching search[0..i-1] with value[0..j-1]
  const dp: number[][] = Array(searchLen + 1).fill(null).map(() =>
    Array(valueLen + 1).fill(0)
  );

  // Base case: empty search matches everything perfectly
  for (let j = 0; j <= valueLen; j++) {
    dp[0][j] = 1;
  }

  // Fill DP table
  for (let i = 1; i <= searchLen; i++) {
    for (let j = 1; j <= valueLen; j++) {
      if (search[i - 1] === value[j - 1]) {
        // Character matches
        let score = dp[i - 1][j - 1];

        // Bonus for matching at special positions
        if (j === 1) {
          // Start of string
          score *= 1.0;
        } else {
          const prevChar = value[j - 2];
          if (/[\s\-_/.]/.test(prevChar)) {
            // After separator
            score *= 0.95;
          } else if (/[A-Z]/.test(value[j - 1]) && /[a-z]/.test(prevChar)) {
            // CamelCase boundary
            score *= 0.9;
          } else {
            // Regular character
            score *= 0.85;
          }
        }

        dp[i][j] = Math.max(dp[i][j], score);
      }

      // Skip character in value (with penalty)
      if (j > 0) {
        dp[i][j] = Math.max(dp[i][j], dp[i][j - 1] * DISTANCE_PENALTY);
      }
    }
  }

  return dp[searchLen][valueLen];
}

/**
 * Main filter function
 */
export function enhancedFilter(
  value: string,
  search: string,
  keywords?: string[]
): number {
  const normalizedSearch = normalize(search);

  // Empty search matches everything
  if (normalizedSearch.length === 0) {
    return SCORE_PERFECT_MATCH;
  }

  const normalizedValue = normalize(value);

  // Strip number prefixes from task items (e.g., "1:task:" -> "task:")
  const cleanValue = normalizedValue.replace(/^\d+\s*:?\s*/, '');

  // Check perfect match
  if (cleanValue === normalizedSearch) {
    return SCORE_PERFECT_MATCH;
  }

  // Check prefix match
  if (cleanValue.startsWith(normalizedSearch)) {
    return SCORE_PREFIX_MATCH;
  }

  // Check acronym match
  if (matchesAcronym(cleanValue, normalizedSearch)) {
    return SCORE_ACRONYM_MATCH;
  }

  // Check word start match
  if (matchesWordStart(cleanValue, normalizedSearch)) {
    return SCORE_WORD_START_MATCH;
  }

  // Check keywords if provided
  if (keywords && keywords.length > 0) {
    for (const keyword of keywords) {
      const normalizedKeyword = normalize(keyword);

      if (normalizedKeyword === normalizedSearch) {
        return SCORE_KEYWORD_MATCH;
      }

      if (normalizedKeyword.startsWith(normalizedSearch)) {
        return SCORE_KEYWORD_MATCH * 0.95;
      }

      if (normalizedKeyword.includes(normalizedSearch)) {
        return SCORE_KEYWORD_MATCH * 0.9;
      }

      if (matchesAcronym(normalizedKeyword, normalizedSearch)) {
        return SCORE_KEYWORD_MATCH * 0.85;
      }
    }
  }

  // Check simple contains
  if (cleanValue.includes(normalizedSearch)) {
    // Calculate position-based score
    const position = cleanValue.indexOf(normalizedSearch);
    const positionPenalty = Math.pow(DISTANCE_PENALTY, position);
    return SCORE_CONTAINS_MATCH * positionPenalty;
  }

  // Fall back to fuzzy matching
  const fuzzyScore = fuzzyMatchScore(cleanValue, normalizedSearch);

  // Only return fuzzy matches above a threshold
  if (fuzzyScore > 0.3) {
    return SCORE_FUZZY_MATCH * fuzzyScore;
  }

  return SCORE_NO_MATCH;
}
