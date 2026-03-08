/**
 * Agent Catalog - Pure metadata for UI display, separated from execution config.
 *
 * This module provides lightweight agent metadata that can be safely imported
 * by client-side code without pulling in Node-dependent execution logic.
 *
 * For server-side execution configuration (commands, args, environment functions),
 * see agentConfig.ts.
 */

export type AgentVendor =
  | "anthropic"
  | "openai"
  | "google"
  | "opencode"
  | "qwen"
  | "cursor"
  | "amp"
  | "xai"
  | "openrouter";

export type ModelTier = "free" | "paid";

/**
 * Model variant for thinking/reasoning modes (inspired by OpenCode)
 */
export interface ModelVariant {
  /** Variant ID, e.g. "default", "high", "max" */
  id: string;
  /** Human-readable label, e.g. "High Thinking" */
  displayName: string;
  /** Optional description */
  description?: string;
}

/**
 * Default variants per vendor (OpenCode-style)
 * - Anthropic: Default/High/Max thinking budget
 * - OpenAI: None to XHigh reasoning effort
 * - Google: Low/High budget
 */
export const DEFAULT_VARIANTS: Record<AgentVendor, ModelVariant[]> = {
  anthropic: [
    { id: "default", displayName: "Default" },
    { id: "high", displayName: "High Thinking", description: "Higher thinking budget" },
    { id: "max", displayName: "Max Thinking", description: "Maximum thinking budget" },
  ],
  openai: [
    { id: "none", displayName: "No Reasoning" },
    { id: "low", displayName: "Low", description: "Low reasoning effort" },
    { id: "medium", displayName: "Medium", description: "Medium reasoning effort" },
    { id: "high", displayName: "High", description: "High reasoning effort" },
  ],
  google: [
    { id: "default", displayName: "Default" },
    { id: "low", displayName: "Low Budget", description: "Lower token budget" },
    { id: "high", displayName: "High Budget", description: "Higher token budget" },
  ],
  opencode: [{ id: "default", displayName: "Default" }],
  qwen: [{ id: "default", displayName: "Default" }],
  cursor: [{ id: "default", displayName: "Default" }],
  amp: [{ id: "default", displayName: "Default" }],
  xai: [{ id: "default", displayName: "Default" }],
  openrouter: [{ id: "default", displayName: "Default" }],
};

/**
 * Get variants for a vendor (with fallback to default)
 */
export function getVariantsForVendor(vendor: AgentVendor): ModelVariant[] {
  return DEFAULT_VARIANTS[vendor] ?? [{ id: "default", displayName: "Default" }];
}

export interface AgentCatalogEntry {
  /** Stable ID matching AgentConfig.name, e.g. "claude/opus-4.6" */
  name: string;
  /** Human-readable label, e.g. "Opus 4.6" */
  displayName: string;
  /** Vendor for grouping & logo selection */
  vendor: AgentVendor;
  /** Environment variable names required for this agent */
  requiredApiKeys: string[];
  /** Pricing tier */
  tier: ModelTier;
  /** Whether this agent is disabled in the UI */
  disabled?: boolean;
  /** Reason shown in tooltip when disabled */
  disabledReason?: string;
  /** Optional tags for filtering, e.g. ["reasoning", "free", "latest", "recommended"] */
  tags?: string[];
  /** Custom variants for this model (overrides vendor defaults) */
  variants?: ModelVariant[];
  /** Default variant ID to use */
  defaultVariant?: string;
}

// Import per-provider catalogs
import { AMP_CATALOG } from "./providers/amp/catalog";
import { CLAUDE_CATALOG } from "./providers/anthropic/catalog";
import { CURSOR_CATALOG } from "./providers/cursor/catalog";
import { GEMINI_CATALOG } from "./providers/gemini/catalog";
import { GROK_CATALOG } from "./providers/grok/catalog";
import { CODEX_CATALOG } from "./providers/openai/catalog";
import { OPENCODE_CATALOG } from "./providers/opencode/catalog";
import { QWEN_CATALOG } from "./providers/qwen/catalog";
import { getPluginLoader } from "./providers/plugin-loader";

/**
 * Feature flag for enabling dynamic plugin loading.
 * When true, getAgentCatalog() uses the PluginLoader.
 * When false (default), uses the static AGENT_CATALOG array.
 */
const USE_DYNAMIC_LOADING = process.env.CMUX_DYNAMIC_PLUGINS === "true";

/**
 * Aggregated catalog of all agent entries.
 * Order matches AGENT_CONFIGS in agentConfig.ts for consistent UI display.
 * @deprecated Use getAgentCatalog() for new code to support dynamic plugin loading.
 */
export const AGENT_CATALOG: AgentCatalogEntry[] = [
  ...CLAUDE_CATALOG,
  ...CODEX_CATALOG,
  ...AMP_CATALOG,
  ...OPENCODE_CATALOG,
  ...GEMINI_CATALOG,
  ...QWEN_CATALOG,
  ...GROK_CATALOG,
  ...CURSOR_CATALOG,
];

/**
 * Get all agent catalog entries.
 *
 * Uses dynamic plugin loading when CMUX_DYNAMIC_PLUGINS=true,
 * otherwise falls back to the static AGENT_CATALOG array.
 *
 * @returns Array of agent catalog entries
 */
export function getAgentCatalog(): AgentCatalogEntry[] {
  if (USE_DYNAMIC_LOADING) {
    const loader = getPluginLoader();
    if (loader.isLoaded()) {
      return loader.getAllCatalog();
    }
    // Fall back to static if plugins haven't been loaded yet
    console.warn(
      "[getAgentCatalog] Dynamic loading enabled but plugins not loaded, using static catalog"
    );
  }
  return AGENT_CATALOG;
}

// Re-export individual catalogs for granular imports
export {
  AMP_CATALOG,
  CLAUDE_CATALOG,
  CODEX_CATALOG,
  CURSOR_CATALOG,
  GEMINI_CATALOG,
  GROK_CATALOG,
  OPENCODE_CATALOG,
  QWEN_CATALOG,
};
