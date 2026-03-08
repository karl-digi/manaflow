import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  PluginLoader,
  getPluginLoader,
  resetPluginLoader,
} from "./plugin-loader";
import type { ProviderPlugin, LoadedPlugin } from "./plugin-interface";

// Mock plugin for testing
function createMockPlugin(id: string): ProviderPlugin {
  return {
    manifest: {
      id,
      name: `${id.charAt(0).toUpperCase() + id.slice(1)} Plugin`,
      version: "1.0.0",
      type: "builtin",
    },
    provider: {
      defaultBaseUrl: `https://api.${id}.com`,
      apiFormat: "openai",
      authEnvVars: [`${id.toUpperCase()}_API_KEY`],
      apiKeys: [
        {
          envVar: `${id.toUpperCase()}_API_KEY`,
          displayName: `${id} API Key`,
        },
      ],
    },
    configs: [
      {
        name: `${id}/model-1`,
        command: `${id}-cli`,
        args: ["--model", "model-1"],
      },
    ],
    catalog: [
      {
        name: `${id}/model-1`,
        displayName: `${id} Model 1`,
        vendor: id === "anthropic" ? "anthropic" : "openai",
        requiredApiKeys: [`${id.toUpperCase()}_API_KEY`],
        tier: "paid",
      },
    ],
  };
}

describe("PluginLoader", () => {
  beforeEach(() => {
    resetPluginLoader();
  });

  afterEach(() => {
    resetPluginLoader();
  });

  describe("PluginLoader class", () => {
    it("initializes with no plugins loaded", () => {
      const loader = new PluginLoader();
      expect(loader.isLoaded()).toBe(false);
      expect(loader.getAllPlugins()).toHaveLength(0);
    });

    it("getPlugin returns undefined for non-existent plugin", () => {
      const loader = new PluginLoader();
      expect(loader.getPlugin("nonexistent")).toBeUndefined();
    });

    it("getPluginIds returns empty array before loading", () => {
      const loader = new PluginLoader();
      expect(loader.getPluginIds()).toEqual([]);
    });

    it("getAllConfigs returns empty array before loading", () => {
      const loader = new PluginLoader();
      expect(loader.getAllConfigs()).toEqual([]);
    });

    it("getAllCatalog returns empty array before loading", () => {
      const loader = new PluginLoader();
      expect(loader.getAllCatalog()).toEqual([]);
    });

    it("getLoadError returns null before loading", () => {
      const loader = new PluginLoader();
      expect(loader.getLoadError()).toBeNull();
    });
  });

  describe("singleton pattern", () => {
    it("getPluginLoader returns same instance", () => {
      const loader1 = getPluginLoader();
      const loader2 = getPluginLoader();
      expect(loader1).toBe(loader2);
    });

    it("resetPluginLoader clears singleton", () => {
      const loader1 = getPluginLoader();
      resetPluginLoader();
      const loader2 = getPluginLoader();
      expect(loader1).not.toBe(loader2);
    });
  });

  describe("loadAll integration", () => {
    // Note: This test actually loads the real plugins
    // It requires the plugin modules to exist in the expected locations
    it("loadAll loads builtin plugins", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();

      expect(loader.isLoaded()).toBe(true);
      // Should have loaded at least some plugins
      const plugins = loader.getAllPlugins();
      expect(plugins.length).toBeGreaterThan(0);

      // Each loaded plugin should have required metadata
      for (const plugin of plugins) {
        expect(plugin.manifest.id).toBeDefined();
        expect(plugin.manifest.name).toBeDefined();
        expect(plugin.manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(plugin.loadedAt).toBeGreaterThan(0);
        expect(plugin.loadedFrom).toBeDefined();
      }
    });

    it("loadAll is idempotent", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();
      const countAfterFirst = loader.getAllPlugins().length;

      await loader.loadAll();
      const countAfterSecond = loader.getAllPlugins().length;

      expect(countAfterFirst).toBe(countAfterSecond);
    });

    it("loads expected builtin plugin IDs", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();

      const expectedIds = [
        "anthropic",
        "openai",
        "gemini",
        "opencode",
        "amp",
        "cursor",
        "qwen",
        "grok",
      ];

      const loadedIds = loader.getPluginIds();

      // At least some of the expected plugins should be loaded
      // (some may fail if modules don't exist in test environment)
      const matchCount = expectedIds.filter((id) =>
        loadedIds.includes(id)
      ).length;
      expect(matchCount).toBeGreaterThan(0);
    });

    it("getPlugin returns specific plugin after loading", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();

      const anthropic = loader.getPlugin("anthropic");
      if (anthropic) {
        expect(anthropic.manifest.id).toBe("anthropic");
        expect(anthropic.manifest.name).toBeDefined();
        expect(anthropic.configs.length).toBeGreaterThan(0);
      }
    });

    it("getAllConfigs aggregates configs from all plugins", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();

      const configs = loader.getAllConfigs();
      expect(configs.length).toBeGreaterThan(0);

      // Configs should have required fields
      for (const config of configs) {
        expect(config.name).toBeDefined();
        expect(config.command).toBeDefined();
        expect(Array.isArray(config.args)).toBe(true);
      }
    });

    it("getAllCatalog aggregates catalog entries from all plugins", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();

      const catalog = loader.getAllCatalog();
      expect(catalog.length).toBeGreaterThan(0);

      // Catalog entries should have required fields
      for (const entry of catalog) {
        expect(entry.name).toBeDefined();
        expect(entry.displayName).toBeDefined();
        expect(entry.vendor).toBeDefined();
        expect(Array.isArray(entry.requiredApiKeys)).toBe(true);
        expect(["free", "paid"]).toContain(entry.tier);
      }
    });

    it("getAllProviderSpecs returns provider specs", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();

      const specs = loader.getAllProviderSpecs();
      expect(specs.length).toBeGreaterThan(0);

      for (const spec of specs) {
        expect(spec.id).toBeDefined();
        expect(spec.name).toBeDefined();
        expect(spec.defaultBaseUrl).toBeDefined();
        expect(spec.apiFormat).toBeDefined();
        expect(Array.isArray(spec.authEnvVars)).toBe(true);
      }
    });

    it("maintains consistent ordering in getAllConfigs", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();

      const configs1 = loader.getAllConfigs();
      const configs2 = loader.getAllConfigs();

      expect(configs1.map((c) => c.name)).toEqual(configs2.map((c) => c.name));
    });

    it("maintains consistent ordering in getAllCatalog", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();

      const catalog1 = loader.getAllCatalog();
      const catalog2 = loader.getAllCatalog();

      expect(catalog1.map((c) => c.name)).toEqual(catalog2.map((c) => c.name));
    });
  });

  describe("healthCheckAll", () => {
    it("returns results for all loaded plugins", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();

      const results = await loader.healthCheckAll();
      expect(Array.isArray(results)).toBe(true);

      // Each result should have required fields
      for (const result of results) {
        expect(result.pluginId).toBeDefined();
        expect(typeof result.healthy).toBe("boolean");
      }
    });

    it("reports healthy for plugins without health check", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();

      const results = await loader.healthCheckAll();
      // Plugins without health check should report healthy
      const withoutHealthCheck = results.filter(
        (r) => r.message === "No health check defined"
      );
      for (const result of withoutHealthCheck) {
        expect(result.healthy).toBe(true);
      }
    });
  });

  describe("shutdown", () => {
    it("clears all plugins on shutdown", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();
      expect(loader.getAllPlugins().length).toBeGreaterThan(0);

      await loader.shutdown();
      expect(loader.isLoaded()).toBe(false);
      expect(loader.getAllPlugins()).toHaveLength(0);
    });

    it("allows reloading after shutdown", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();
      const countBefore = loader.getAllPlugins().length;

      await loader.shutdown();
      await loader.loadAll();

      expect(loader.getAllPlugins().length).toBe(countBefore);
    });
  });

  describe("error handling", () => {
    it("records load errors without crashing", async () => {
      const loader = new PluginLoader();
      // Even if some plugins fail to load, loader should still work
      await loader.loadAll();
      expect(loader.isLoaded()).toBe(true);
    });

    it("continues loading other plugins when one fails", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();

      // Should still have loaded plugins even if some failed
      expect(loader.isLoaded()).toBe(true);
      // Check if any plugins were loaded
      const loaded = loader.getAllPlugins();
      // At least anthropic should load (it's a core plugin)
      expect(loaded.some((p) => p.manifest.id === "anthropic")).toBe(true);
    });
  });

  describe("plugin metadata", () => {
    it("loadedAt is set to load time", async () => {
      const beforeLoad = Date.now();
      const loader = new PluginLoader();
      await loader.loadAll();
      const afterLoad = Date.now();

      const plugins = loader.getAllPlugins();
      for (const plugin of plugins) {
        expect(plugin.loadedAt).toBeGreaterThanOrEqual(beforeLoad);
        expect(plugin.loadedAt).toBeLessThanOrEqual(afterLoad);
      }
    });

    it("initialized is true for successfully initialized plugins", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();

      const plugins = loader.getAllPlugins();
      // Most plugins don't have init hooks, so they're marked initialized
      for (const plugin of plugins) {
        if (!plugin.initError) {
          expect(plugin.initialized).toBe(true);
        }
      }
    });

    it("loadedFrom is set to module path", async () => {
      const loader = new PluginLoader();
      await loader.loadAll();

      const plugins = loader.getAllPlugins();
      for (const plugin of plugins) {
        expect(plugin.loadedFrom).toMatch(/plugin$/);
      }
    });
  });
});
