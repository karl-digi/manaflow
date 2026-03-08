import type { AgentCatalogEntry } from "../../agent-catalog";
import { OPENCODE_KNOWN_FREE } from "./free-models";

/**
 * OpenCode catalog - only includes known FREE models without -free suffix.
 *
 * Design rationale:
 * - Free models with -free suffix: Discovered at RUNTIME via modelDiscovery
 * - Free models without suffix: Curated here (big-pickle, gpt-5-nano)
 * - Paid models: Discovered at RUNTIME via Convex modelDiscovery.discoverOpencodeModels
 *
 * Free model detection uses naming convention heuristics (see free-models.ts):
 * - Models ending with `-free` suffix are free
 * - Known exceptions in OPENCODE_KNOWN_FREE are free
 *
 * See: packages/convex/convex/modelDiscovery.ts
 */
export const OPENCODE_CATALOG: AgentCatalogEntry[] = OPENCODE_KNOWN_FREE.map(
  (modelId) => ({
    name: `opencode/${modelId}`,
    displayName: modelId,
    vendor: "opencode" as const,
    requiredApiKeys: [],
    tier: "free" as const,
    tags: ["free"],
  })
);
