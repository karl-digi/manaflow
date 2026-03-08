// OpenCode free model detection using naming convention heuristics
// Instead of probing models at build-time, we use predictable naming patterns:
// - Models ending with `-free` suffix (e.g., `glm-5-free`, `kimi-k2.5-free`)
// - Known exceptions without suffix that are documented as free

/**
 * Known free models without -free suffix (manually curated).
 * These are edge cases that don't follow the naming convention.
 */
export const OPENCODE_KNOWN_FREE = ["big-pickle", "gpt-5-nano"] as const;

/**
 * Determine if a model ID is free using naming convention.
 * @param modelId - The OpenCode model ID (e.g., "glm-5-free", "big-pickle")
 * @returns true if the model is free (no API key required)
 */
export function isOpencodeFreeModel(modelId: string): boolean {
  return (
    modelId.endsWith("-free") ||
    OPENCODE_KNOWN_FREE.includes(modelId as (typeof OPENCODE_KNOWN_FREE)[number])
  );
}

// Export for backwards compatibility with catalog.ts and configs.ts
export const OPENCODE_FREE_MODEL_IDS = OPENCODE_KNOWN_FREE;
export type OpencodeFreeModelId = (typeof OPENCODE_KNOWN_FREE)[number];
