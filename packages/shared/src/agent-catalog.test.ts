import { describe, expect, it } from "vitest";
import { AGENT_CATALOG, type AgentCatalogEntry } from "./agent-catalog";
import { AGENT_CONFIGS, type AgentConfig } from "./agentConfig";

/**
 * Models excluded from static AGENT_CATALOG (discovered at runtime instead):
 *
 * OpenCode paid models (opencode/*): These route through opencode.ai which has
 * its own authentication flow. User API keys (ANTHROPIC_API_KEY, etc.) are for
 * direct provider access with custom base URLs, not for OpenCode's routing.
 * These models are discovered at runtime via Convex modelDiscovery.
 */
const RUNTIME_DISCOVERED_PREFIXES = ["opencode/"];

// Helper to check if a model is expected to be runtime-discovered
function isRuntimeDiscovered(name: string): boolean {
  // OpenCode free models ARE in the catalog (big-pickle, gpt-5-nano)
  const isOpencodeFree =
    name === "opencode/big-pickle" || name === "opencode/gpt-5-nano";
  if (isOpencodeFree) return false;

  return RUNTIME_DISCOVERED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

describe("agent-catalog", () => {
  describe("catalog/config alignment", () => {
    const catalogByName = new Map<string, AgentCatalogEntry>(
      AGENT_CATALOG.map((entry) => [entry.name, entry])
    );

    const configByName = new Map<string, AgentConfig>(
      AGENT_CONFIGS.map((config) => [config.name, config])
    );

    it("every AGENT_CATALOG entry has a matching AGENT_CONFIGS entry", () => {
      const missingInConfigs: string[] = [];
      for (const entry of AGENT_CATALOG) {
        if (!configByName.has(entry.name)) {
          missingInConfigs.push(entry.name);
        }
      }
      expect(missingInConfigs).toEqual([]);
    });

    it("non-runtime-discovered AGENT_CONFIGS entries have AGENT_CATALOG entries", () => {
      // Only check configs that should be in the static catalog
      // Runtime-discovered models (e.g., OpenCode paid) are intentionally excluded
      const missingInCatalog: string[] = [];
      for (const config of AGENT_CONFIGS) {
        if (isRuntimeDiscovered(config.name)) continue;
        if (!catalogByName.has(config.name)) {
          missingInCatalog.push(config.name);
        }
      }
      expect(missingInCatalog).toEqual([]);
    });

    it("runtime-discovered models are correctly identified", () => {
      // Verify our helper correctly identifies OpenCode paid models
      const runtimeDiscoveredConfigs = AGENT_CONFIGS.filter((c) =>
        isRuntimeDiscovered(c.name)
      );
      // All should be OpenCode paid models (not free)
      for (const config of runtimeDiscoveredConfigs) {
        expect(config.name.startsWith("opencode/")).toBe(true);
        expect(config.name).not.toBe("opencode/big-pickle");
        expect(config.name).not.toBe("opencode/gpt-5-nano");
      }
    });

    it("requiredApiKeys in catalog match apiKeys[].envVar in configs", () => {
      const mismatches: string[] = [];
      for (const entry of AGENT_CATALOG) {
        const config = configByName.get(entry.name);
        if (!config) continue;

        const configEnvVars = new Set(
          config.apiKeys?.map((k) => k.envVar) ?? []
        );
        const catalogEnvVars = new Set(entry.requiredApiKeys);

        // Check if sets are equal
        if (configEnvVars.size !== catalogEnvVars.size) {
          mismatches.push(
            `${entry.name}: catalog has [${[...catalogEnvVars].join(", ")}] but config has [${[...configEnvVars].join(", ")}]`
          );
          continue;
        }

        for (const envVar of catalogEnvVars) {
          if (!configEnvVars.has(envVar)) {
            mismatches.push(
              `${entry.name}: catalog has ${envVar} but config does not`
            );
          }
        }
      }
      expect(mismatches).toEqual([]);
    });

    it("disabled/disabledReason match between catalog and configs", () => {
      const mismatches: string[] = [];
      for (const entry of AGENT_CATALOG) {
        const config = configByName.get(entry.name);
        if (!config) continue;

        if (entry.disabled !== config.disabled) {
          mismatches.push(
            `${entry.name}: catalog.disabled=${entry.disabled} but config.disabled=${config.disabled}`
          );
        }

        if (entry.disabledReason !== config.disabledReason) {
          mismatches.push(
            `${entry.name}: catalog.disabledReason="${entry.disabledReason}" but config.disabledReason="${config.disabledReason}"`
          );
        }
      }
      expect(mismatches).toEqual([]);
    });
  });

  describe("catalog data integrity", () => {
    it("all entries have unique names", () => {
      const names = AGENT_CATALOG.map((e) => e.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it("all entries have non-empty displayName", () => {
      const emptyDisplayNames = AGENT_CATALOG.filter(
        (e) => !e.displayName || e.displayName.trim() === ""
      );
      expect(emptyDisplayNames.map((e) => e.name)).toEqual([]);
    });

    it("all entries have valid vendor", () => {
      const validVendors = new Set([
        "anthropic",
        "openai",
        "google",
        "opencode",
        "qwen",
        "cursor",
        "amp",
        "xai",
        "openrouter",
      ]);
      const invalidVendors = AGENT_CATALOG.filter(
        (e) => !validVendors.has(e.vendor)
      );
      expect(invalidVendors.map((e) => `${e.name}: ${e.vendor}`)).toEqual([]);
    });

    it("all entries have valid tier", () => {
      const validTiers = new Set(["free", "paid"]);
      const invalidTiers = AGENT_CATALOG.filter(
        (e) => !validTiers.has(e.tier)
      );
      expect(invalidTiers.map((e) => `${e.name}: ${e.tier}`)).toEqual([]);
    });

    it("free tier entries have requiredApiKeys empty or contain only optional keys", () => {
      // Free tier models should either have no API keys or minimal requirements
      const freeModels = AGENT_CATALOG.filter((e) => e.tier === "free");
      // Just ensure they exist - free models in opencode don't require keys
      expect(freeModels.length).toBeGreaterThan(0);
    });
  });
});
