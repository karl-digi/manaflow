import type { AgentConfig } from "./agentConfig";
import { AGENT_CONFIGS } from "./agentConfig";

export type ApiKeyModelsByEnv = Record<string, string[]>;

export function computeApiKeyModelsByEnv(
  agentConfigs: readonly AgentConfig[]
): ApiKeyModelsByEnv {
  const map = new Map<string, Set<string>>();
  for (const config of agentConfigs) {
    const envVars = config.apiKeys?.map((k) => k.envVar) ?? [];
    if (envVars.length === 0) continue;
    const label = config.name; // show full agent name
    for (const env of envVars) {
      if (!map.has(env)) map.set(env, new Set<string>());
      map.get(env)!.add(label);
    }
  }
  const out: ApiKeyModelsByEnv = {};
  for (const [env, labels] of map.entries()) {
    out[env] = Array.from(labels).sort((a, b) => a.localeCompare(b));
  }
  return out;
}

export const API_KEY_MODELS_BY_ENV: ApiKeyModelsByEnv =
  computeApiKeyModelsByEnv(AGENT_CONFIGS);
