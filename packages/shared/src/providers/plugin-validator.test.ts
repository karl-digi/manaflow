import { describe, expect, it } from "vitest";
import {
  validatePlugin,
  assertValidPlugin,
  PluginManifestSchema,
  AgentConfigSchema,
  AgentCatalogEntrySchema,
  ProviderPluginSchema,
  PluginProviderSpecSchema,
} from "./plugin-validator";

describe("PluginValidator", () => {
  // Helper to create a minimal valid plugin
  function createValidPlugin() {
    return {
      manifest: {
        id: "test-plugin",
        name: "Test Plugin",
        version: "1.0.0",
        type: "builtin" as const,
      },
      provider: {
        defaultBaseUrl: "https://api.example.com",
        apiFormat: "openai" as const,
        authEnvVars: ["TEST_API_KEY"],
        apiKeys: [
          {
            envVar: "TEST_API_KEY",
            displayName: "Test API Key",
          },
        ],
      },
      configs: [
        {
          name: "test/model-1",
          command: "test-cli",
          args: ["--model", "model-1"],
        },
      ],
      catalog: [
        {
          name: "test/model-1",
          displayName: "Test Model 1",
          vendor: "openai" as const,
          requiredApiKeys: ["TEST_API_KEY"],
          tier: "paid" as const,
        },
      ],
    };
  }

  describe("PluginManifestSchema", () => {
    it("validates correct manifest", () => {
      const manifest = {
        id: "my-plugin",
        name: "My Plugin",
        version: "1.0.0",
        type: "builtin",
      };
      const result = PluginManifestSchema.safeParse(manifest);
      expect(result.success).toBe(true);
    });

    it("rejects empty plugin ID", () => {
      const manifest = {
        id: "",
        name: "My Plugin",
        version: "1.0.0",
        type: "builtin",
      };
      const result = PluginManifestSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });

    it("rejects invalid plugin ID format", () => {
      const invalid = ["MyPlugin", "123plugin", "plugin_name", "CAPS"];
      for (const id of invalid) {
        const manifest = {
          id,
          name: "Test",
          version: "1.0.0",
          type: "builtin",
        };
        const result = PluginManifestSchema.safeParse(manifest);
        expect(result.success).toBe(false);
      }
    });

    it("accepts valid plugin ID formats", () => {
      const valid = ["plugin", "my-plugin", "plugin123", "a1-b2-c3"];
      for (const id of valid) {
        const manifest = {
          id,
          name: "Test",
          version: "1.0.0",
          type: "builtin",
        };
        const result = PluginManifestSchema.safeParse(manifest);
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid version format", () => {
      const invalid = ["1.0", "v1.0.0", "1", "1.0.0.0", "abc"];
      for (const version of invalid) {
        const manifest = {
          id: "test",
          name: "Test",
          version,
          type: "builtin",
        };
        const result = PluginManifestSchema.safeParse(manifest);
        expect(result.success).toBe(false);
      }
    });

    it("accepts valid version formats", () => {
      const valid = ["1.0.0", "0.0.1", "10.20.30", "999.999.999"];
      for (const version of valid) {
        const manifest = {
          id: "test",
          name: "Test",
          version,
          type: "builtin",
        };
        const result = PluginManifestSchema.safeParse(manifest);
        expect(result.success).toBe(true);
      }
    });

    it("accepts valid plugin types", () => {
      const types = ["builtin", "community", "team"];
      for (const type of types) {
        const manifest = {
          id: "test",
          name: "Test",
          version: "1.0.0",
          type,
        };
        const result = PluginManifestSchema.safeParse(manifest);
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid plugin type", () => {
      const manifest = {
        id: "test",
        name: "Test",
        version: "1.0.0",
        type: "invalid",
      };
      const result = PluginManifestSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });
  });

  describe("AgentConfigSchema", () => {
    it("validates correct agent config", () => {
      const config = {
        name: "claude/opus-4.5",
        command: "claude-code",
        args: ["--model", "opus"],
      };
      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("accepts provider-only names", () => {
      const config = {
        name: "amp",
        command: "amp-cli",
        args: [],
      };
      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("accepts names with variants", () => {
      const config = {
        name: "qwen/qwen3-coder:free",
        command: "opencode",
        args: [],
      };
      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("rejects invalid name formats", () => {
      const invalid = ["", "MyAgent", "CAPS/model", "123agent"];
      for (const name of invalid) {
        const config = {
          name,
          command: "test",
          args: [],
        };
        const result = AgentConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }
    });

    it("rejects empty command", () => {
      const config = {
        name: "test/model",
        command: "",
        args: [],
      };
      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe("AgentCatalogEntrySchema", () => {
    it("validates correct catalog entry", () => {
      const entry = {
        name: "claude/opus-4.5",
        displayName: "Claude Opus 4.5",
        vendor: "anthropic",
        requiredApiKeys: ["ANTHROPIC_API_KEY"],
        tier: "paid",
      };
      const result = AgentCatalogEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it("accepts all valid vendors", () => {
      const vendors = [
        "anthropic",
        "openai",
        "google",
        "opencode",
        "qwen",
        "cursor",
        "amp",
        "xai",
        "openrouter",
      ];
      for (const vendor of vendors) {
        const entry = {
          name: "test/model",
          displayName: "Test",
          vendor,
          requiredApiKeys: [],
          tier: "paid",
        };
        const result = AgentCatalogEntrySchema.safeParse(entry);
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid vendor", () => {
      const entry = {
        name: "test/model",
        displayName: "Test",
        vendor: "invalid-vendor",
        requiredApiKeys: [],
        tier: "paid",
      };
      const result = AgentCatalogEntrySchema.safeParse(entry);
      expect(result.success).toBe(false);
    });

    it("accepts both tier values", () => {
      for (const tier of ["free", "paid"]) {
        const entry = {
          name: "test/model",
          displayName: "Test",
          vendor: "openai",
          requiredApiKeys: [],
          tier,
        };
        const result = AgentCatalogEntrySchema.safeParse(entry);
        expect(result.success).toBe(true);
      }
    });

    it("accepts optional fields", () => {
      const entry = {
        name: "test/model",
        displayName: "Test",
        vendor: "openai",
        requiredApiKeys: [],
        tier: "paid",
        disabled: true,
        disabledReason: "Maintenance",
        tags: ["fast", "cheap"],
        variants: [{ id: "v1", displayName: "Variant 1" }],
        defaultVariant: "v1",
      };
      const result = AgentCatalogEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
    });
  });

  describe("PluginProviderSpecSchema", () => {
    it("validates correct provider spec", () => {
      const spec = {
        defaultBaseUrl: "https://api.example.com",
        apiFormat: "openai",
        authEnvVars: ["API_KEY"],
        apiKeys: [{ envVar: "API_KEY", displayName: "API Key" }],
      };
      const result = PluginProviderSpecSchema.safeParse(spec);
      expect(result.success).toBe(true);
    });

    it("rejects invalid URL", () => {
      const spec = {
        defaultBaseUrl: "not-a-url",
        apiFormat: "openai",
        authEnvVars: ["API_KEY"],
        apiKeys: [],
      };
      const result = PluginProviderSpecSchema.safeParse(spec);
      expect(result.success).toBe(false);
    });

    it("accepts all valid API formats", () => {
      const formats = [
        "anthropic",
        "openai",
        "bedrock",
        "vertex",
        "passthrough",
      ];
      for (const apiFormat of formats) {
        const spec = {
          defaultBaseUrl: "https://api.example.com",
          apiFormat,
          authEnvVars: ["KEY"],
          apiKeys: [],
        };
        const result = PluginProviderSpecSchema.safeParse(spec);
        expect(result.success).toBe(true);
      }
    });

    it("rejects empty authEnvVars", () => {
      const spec = {
        defaultBaseUrl: "https://api.example.com",
        apiFormat: "openai",
        authEnvVars: [],
        apiKeys: [],
      };
      const result = PluginProviderSpecSchema.safeParse(spec);
      expect(result.success).toBe(false);
    });
  });

  describe("ProviderPluginSchema", () => {
    it("validates complete valid plugin", () => {
      const plugin = createValidPlugin();
      const result = ProviderPluginSchema.safeParse(plugin);
      expect(result.success).toBe(true);
    });

    it("rejects plugin without configs", () => {
      const plugin = createValidPlugin();
      plugin.configs = [];
      const result = ProviderPluginSchema.safeParse(plugin);
      expect(result.success).toBe(false);
    });

    it("rejects plugin without catalog", () => {
      const plugin = createValidPlugin();
      plugin.catalog = [];
      const result = ProviderPluginSchema.safeParse(plugin);
      expect(result.success).toBe(false);
    });
  });

  describe("validatePlugin", () => {
    it("returns valid for correct plugin", () => {
      const plugin = createValidPlugin();
      const result = validatePlugin(plugin);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("returns errors for invalid plugin structure", () => {
      const plugin = {
        manifest: { id: "test" }, // Missing required fields
      };
      const result = validatePlugin(plugin);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("warns when config has no matching catalog entry", () => {
      const plugin = createValidPlugin();
      plugin.configs.push({
        name: "test/model-2",
        command: "test-cli",
        args: [],
      });
      const result = validatePlugin(plugin);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain(
        "Config 'test/model-2' has no matching catalog entry"
      );
    });

    it("errors when catalog entry has no matching config", () => {
      const plugin = createValidPlugin();
      plugin.catalog.push({
        name: "test/model-orphan",
        displayName: "Orphan Model",
        vendor: "openai" as const,
        requiredApiKeys: [],
        tier: "paid" as const,
      });
      const result = validatePlugin(plugin);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Catalog entry 'test/model-orphan' has no matching config"
      );
    });

    it("errors on config/catalog mismatch in strict mode", () => {
      const plugin = createValidPlugin();
      plugin.configs.push({
        name: "test/model-2",
        command: "test-cli",
        args: [],
      });
      const result = validatePlugin(plugin, { strictCatalogMatch: true });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Config 'test/model-2' has no matching catalog entry"
      );
    });

    it("warns on non-standard prefix", () => {
      const plugin = createValidPlugin();
      plugin.configs[0].name = "custom/model";
      plugin.catalog[0].name = "custom/model";
      const result = validatePlugin(plugin);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("non-standard prefix"))).toBe(
        true
      );
    });

    it("accepts standard prefixes without warning", () => {
      const standardPrefixes = [
        "claude",
        "codex",
        "gemini",
        "opencode",
        "amp",
        "cursor",
        "qwen",
      ];
      for (const prefix of standardPrefixes) {
        const plugin = createValidPlugin();
        plugin.configs[0].name = `${prefix}/model`;
        plugin.catalog[0].name = `${prefix}/model`;
        const result = validatePlugin(plugin);
        expect(
          result.warnings.some((w) => w.includes("non-standard prefix"))
        ).toBe(false);
      }
    });
  });

  describe("assertValidPlugin", () => {
    it("does not throw for valid plugin", () => {
      const plugin = createValidPlugin();
      expect(() => assertValidPlugin(plugin)).not.toThrow();
    });

    it("throws for invalid plugin", () => {
      const plugin = { manifest: {} };
      expect(() => assertValidPlugin(plugin)).toThrow("Invalid plugin");
    });

    it("includes errors in thrown message", () => {
      const plugin = { manifest: { id: "" } };
      expect(() => assertValidPlugin(plugin)).toThrow(/id.*required/i);
    });
  });
});
