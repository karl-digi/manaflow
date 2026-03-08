/**
 * Plugin Loader - Discovers and loads provider plugins.
 *
 * The PluginLoader discovers, validates, and initializes provider plugins,
 * aggregating their configs and catalog entries for use by the system.
 */

import type { AgentConfig } from "../agentConfig";
import type { AgentCatalogEntry } from "../agent-catalog";
import type { ProviderSpec } from "./base-providers";
import type {
  LoadedPlugin,
  PluginHealthCheckResult,
  ProviderPlugin,
} from "./plugin-interface";
import { validatePlugin } from "./plugin-validator";

/**
 * List of builtin plugin IDs that ship with cmux.
 */
const BUILTIN_PLUGINS = [
  "anthropic",
  "openai",
  "gemini",
  "opencode",
  "amp",
  "cursor",
  "qwen",
  "grok",
] as const;

export type BuiltinPluginId = (typeof BUILTIN_PLUGINS)[number];

/**
 * Plugin Loader class for discovering and managing provider plugins.
 */
export class PluginLoader {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private loaded = false;
  private loadError: string | null = null;

  /**
   * Load all builtin plugins.
   * This is the main entry point for plugin discovery.
   */
  async loadAll(): Promise<void> {
    if (this.loaded) {
      return;
    }

    const errors: string[] = [];

    for (const pluginId of BUILTIN_PLUGINS) {
      try {
        await this.loadBuiltinPlugin(pluginId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        errors.push(`Failed to load plugin '${pluginId}': ${message}`);
        console.error(`[PluginLoader] ${errors[errors.length - 1]}`);
      }
    }

    this.loaded = true;
    if (errors.length > 0) {
      this.loadError = errors.join("; ");
    }
  }

  /**
   * Load a builtin plugin by ID.
   */
  private async loadBuiltinPlugin(pluginId: BuiltinPluginId): Promise<void> {
    // Dynamic import of the plugin module
    const modulePath = `./${pluginId}/plugin`;
    let pluginModule: { default: ProviderPlugin } | { [key: string]: ProviderPlugin };

    try {
      pluginModule = await import(modulePath);
    } catch (error) {
      throw new Error(
        `Failed to import plugin module '${modulePath}': ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Get the plugin export (supports both default export and named export)
    const plugin =
      "default" in pluginModule
        ? pluginModule.default
        : Object.values(pluginModule).find(
            (v): v is ProviderPlugin =>
              typeof v === "object" && v !== null && "manifest" in v
          );

    if (!plugin) {
      throw new Error(`Plugin module '${modulePath}' does not export a valid plugin`);
    }

    // Validate the plugin
    const validation = validatePlugin(plugin);
    if (!validation.valid) {
      throw new Error(
        `Plugin '${pluginId}' validation failed:\n${validation.errors.join("\n")}`
      );
    }

    // Create loaded plugin with metadata
    const loadedPlugin: LoadedPlugin = {
      ...plugin,
      loadedFrom: modulePath,
      loadedAt: Date.now(),
      initialized: false,
    };

    // Initialize if lifecycle hook exists
    if (plugin.lifecycle?.initialize) {
      try {
        await plugin.lifecycle.initialize();
        loadedPlugin.initialized = true;
      } catch (error) {
        loadedPlugin.initError =
          error instanceof Error ? error.message : String(error);
        console.error(
          `[PluginLoader] Plugin '${pluginId}' initialization failed: ${loadedPlugin.initError}`
        );
      }
    } else {
      loadedPlugin.initialized = true;
    }

    this.plugins.set(pluginId, loadedPlugin);
  }

  /**
   * Get a loaded plugin by ID.
   */
  getPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Get all loaded plugins.
   */
  getAllPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get all plugin IDs.
   */
  getPluginIds(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Get aggregated agent configs from all loaded plugins.
   * Maintains order: anthropic, openai, amp, opencode, gemini, qwen, grok, cursor
   */
  getAllConfigs(): AgentConfig[] {
    const configs: AgentConfig[] = [];
    // Maintain consistent ordering matching AGENT_CONFIGS
    const orderedIds = [
      "anthropic",
      "openai",
      "amp",
      "opencode",
      "gemini",
      "qwen",
      "grok",
      "cursor",
    ];

    for (const id of orderedIds) {
      const plugin = this.plugins.get(id);
      if (plugin) {
        configs.push(...plugin.configs);
      }
    }

    // Add any remaining plugins not in the ordered list
    for (const [id, plugin] of this.plugins) {
      if (!orderedIds.includes(id)) {
        configs.push(...plugin.configs);
      }
    }

    return configs;
  }

  /**
   * Get aggregated catalog entries from all loaded plugins.
   * Maintains order matching getAllConfigs().
   */
  getAllCatalog(): AgentCatalogEntry[] {
    const catalog: AgentCatalogEntry[] = [];
    const orderedIds = [
      "anthropic",
      "openai",
      "amp",
      "opencode",
      "gemini",
      "qwen",
      "grok",
      "cursor",
    ];

    for (const id of orderedIds) {
      const plugin = this.plugins.get(id);
      if (plugin) {
        catalog.push(...plugin.catalog);
      }
    }

    // Add any remaining plugins not in the ordered list
    for (const [id, plugin] of this.plugins) {
      if (!orderedIds.includes(id)) {
        catalog.push(...plugin.catalog);
      }
    }

    return catalog;
  }

  /**
   * Get aggregated provider specs from all loaded plugins.
   */
  getAllProviderSpecs(): ProviderSpec[] {
    const specs: ProviderSpec[] = [];

    for (const plugin of this.plugins.values()) {
      specs.push({
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        defaultBaseUrl: plugin.provider.defaultBaseUrl,
        apiFormat: plugin.provider.apiFormat,
        authEnvVars: plugin.provider.authEnvVars,
        apiKeys: plugin.provider.apiKeys,
        baseUrlKey: plugin.provider.baseUrlKey,
      });
    }

    return specs;
  }

  /**
   * Run health checks on all loaded plugins.
   */
  async healthCheckAll(): Promise<PluginHealthCheckResult[]> {
    const results: PluginHealthCheckResult[] = [];

    for (const [pluginId, plugin] of this.plugins) {
      if (!plugin.lifecycle?.healthCheck) {
        results.push({
          pluginId,
          healthy: true,
          message: "No health check defined",
        });
        continue;
      }

      try {
        const result = await plugin.lifecycle.healthCheck();
        results.push({
          pluginId,
          healthy: result.healthy,
          message: result.message,
        });
      } catch (error) {
        results.push({
          pluginId,
          healthy: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Gracefully shutdown all plugins.
   */
  async shutdown(): Promise<void> {
    const errors: string[] = [];

    for (const [pluginId, plugin] of this.plugins) {
      if (!plugin.lifecycle?.shutdown) {
        continue;
      }

      try {
        await plugin.lifecycle.shutdown();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        errors.push(`Plugin '${pluginId}' shutdown failed: ${message}`);
        console.error(`[PluginLoader] ${errors[errors.length - 1]}`);
      }
    }

    this.plugins.clear();
    this.loaded = false;

    if (errors.length > 0) {
      throw new Error(`Shutdown errors:\n${errors.join("\n")}`);
    }
  }

  /**
   * Check if plugins have been loaded.
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Get any load errors that occurred.
   */
  getLoadError(): string | null {
    return this.loadError;
  }
}

// Singleton instance
let loaderInstance: PluginLoader | null = null;

/**
 * Get the singleton PluginLoader instance.
 */
export function getPluginLoader(): PluginLoader {
  if (!loaderInstance) {
    loaderInstance = new PluginLoader();
  }
  return loaderInstance;
}

/**
 * Reset the plugin loader (primarily for testing).
 */
export function resetPluginLoader(): void {
  loaderInstance = null;
}
