import { AGENT_CATALOG, type AgentCatalogEntry } from "./agent-catalog";

export type ApiKeyModelsByEnv = Record<string, string[]>;

/**
 * Compute a mapping from environment variable names to agent names that require them.
 */
export function computeApiKeyModelsByEnv(
  entries: readonly AgentCatalogEntry[]
): ApiKeyModelsByEnv {
  const map = new Map<string, Set<string>>();
  for (const entry of entries) {
    const envVars = entry.requiredApiKeys;
    if (envVars.length === 0) continue;
    const label = entry.name; // show full agent name
    for (const envVar of envVars) {
      if (!map.has(envVar)) map.set(envVar, new Set<string>());
      map.get(envVar)!.add(label);
    }
  }
  const out: ApiKeyModelsByEnv = {};
  for (const [envVar, labels] of map.entries()) {
    out[envVar] = Array.from(labels).sort((a, b) => a.localeCompare(b));
  }
  return out;
}

export const API_KEY_MODELS_BY_ENV: ApiKeyModelsByEnv =
  computeApiKeyModelsByEnv(AGENT_CATALOG);
