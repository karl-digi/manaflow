/**
 * Plugin Interface Types for the Provider Plugin System.
 *
 * This module defines the interface that all provider plugins must implement
 * to be discovered and loaded by the PluginLoader.
 */

import type { AgentConfig, AgentConfigApiKey } from "../agentConfig";
import type { AgentCatalogEntry } from "../agent-catalog";
import type { ApiFormat } from "./base-providers";

/**
 * Plugin manifest metadata.
 * Identifies the plugin and its source.
 */
export interface PluginManifest {
  /** Unique plugin identifier (e.g., "anthropic", "openai") */
  id: string;
  /** Human-readable name (e.g., "Anthropic", "OpenAI") */
  name: string;
  /** Semver version string (e.g., "1.0.0") */
  version: string;
  /** Optional description */
  description?: string;
  /** Plugin source type */
  type: "builtin" | "community" | "team";
}

/**
 * Provider specification within a plugin.
 * Defines how to connect to and authenticate with the provider's API.
 */
export interface PluginProviderSpec {
  /** Default API base URL */
  defaultBaseUrl: string;
  /** API format for request/response transformation */
  apiFormat: ApiFormat;
  /** Environment variables that can provide authentication */
  authEnvVars: string[];
  /** API key definitions for authentication */
  apiKeys: AgentConfigApiKey[];
  /** Optional base URL key for custom endpoints */
  baseUrlKey?: AgentConfigApiKey;
}

/**
 * Optional lifecycle hooks for plugins.
 * Called during plugin initialization and shutdown.
 */
export interface PluginLifecycleHooks {
  /** Called after plugin is loaded but before use */
  initialize?: () => Promise<void>;
  /** Health check to verify plugin is operational */
  healthCheck?: () => Promise<{ healthy: boolean; message?: string }>;
  /** Called during graceful shutdown */
  shutdown?: () => Promise<void>;
}

/**
 * Core provider plugin interface.
 * All plugins must export an object conforming to this interface.
 */
export interface ProviderPlugin {
  /** Plugin metadata */
  manifest: PluginManifest;
  /** Provider API specification */
  provider: PluginProviderSpec;
  /** Agent configurations for this provider */
  configs: AgentConfig[];
  /** Agent catalog entries for UI display */
  catalog: AgentCatalogEntry[];
  /** Optional lifecycle hooks */
  lifecycle?: PluginLifecycleHooks;
}

/**
 * Extended plugin interface for loaded plugins.
 * Includes runtime metadata added by the PluginLoader.
 */
export interface LoadedPlugin extends ProviderPlugin {
  /** Path or module from which the plugin was loaded */
  loadedFrom: string;
  /** Timestamp when the plugin was loaded */
  loadedAt: number;
  /** Whether the plugin has been initialized */
  initialized: boolean;
  /** Error message if initialization failed */
  initError?: string;
}

/**
 * Result of a plugin health check across all plugins.
 */
export interface PluginHealthCheckResult {
  pluginId: string;
  healthy: boolean;
  message?: string;
  error?: string;
}
