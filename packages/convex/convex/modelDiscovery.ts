"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import {
  AGENT_CATALOG,
  getVariantsForVendor,
  type AgentVendor,
} from "@cmux/shared/agent-catalog";
import { isOpencodeFreeModel } from "@cmux/shared/providers/opencode/free-models";

const OPENCODE_ZEN_MODELS_URL = "https://opencode.ai/zen/v1/models";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";

/**
 * Fetch model IDs from OpenCode Zen API
 */
async function fetchOpencodeModelIds(): Promise<string[]> {
  const response = await fetch(OPENCODE_ZEN_MODELS_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch OpenCode models: HTTP ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };
  const ids =
    payload?.data?.map((entry) => entry?.id).filter(Boolean) ?? [];

  return ids as string[];
}

/**
 * Discover models from OpenCode Zen API and upsert them into the models table.
 * Free models are determined by naming convention heuristics:
 * - Models ending with `-free` suffix
 * - Known free models in OPENCODE_KNOWN_FREE (big-pickle, gpt-5-nano)
 */
export const discoverOpencodeModels = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    discovered: number;
    free: number;
    paid: number;
  }> => {
    console.log("[modelDiscovery] Starting OpenCode model discovery...");

    const modelIds = await fetchOpencodeModelIds();
    console.log(`[modelDiscovery] Found ${modelIds.length} models from API`);

    const now = Date.now();
    const modelsToUpsert = modelIds.map((modelId) => {
      const isFree = isOpencodeFreeModel(modelId);
      console.log(
        `[modelDiscovery] ${isFree ? "FREE" : "PAID"}: ${modelId}`
      );
      return {
        name: `opencode/${modelId}`,
        displayName: modelId,
        vendor: "opencode",
        source: "discovered" as const,
        discoveredFrom: "opencode-zen",
        discoveredAt: now,
        requiredApiKeys: isFree ? ([] as string[]) : ["OPENCODE_API_KEY"],
        tier: isFree ? ("free" as const) : ("paid" as const),
        tags: isFree ? ["free", "discovered"] : ["discovered"],
        enabled: isFree, // Free models are enabled by default
      };
    });

    const freeCount = modelsToUpsert.filter((m) => m.tier === "free").length;
    const paidCount = modelsToUpsert.length - freeCount;

    console.log(
      `[modelDiscovery] Free: ${freeCount}, Paid: ${paidCount}`
    );

    // Bulk upsert all discovered models
    if (modelsToUpsert.length > 0) {
      const result = await ctx.runMutation(internal.models.bulkUpsert, {
        models: modelsToUpsert,
      });
      console.log(
        `[modelDiscovery] Upserted ${result.upsertedCount} models`
      );
    }

    return {
      discovered: modelIds.length,
      free: freeCount,
      paid: paidCount,
    };
  },
});

/**
 * OpenRouter model type from their API
 */
interface OpenRouterModel {
  id: string;
  name: string;
  pricing?: { prompt: string; completion: string };
  context_length?: number;
}

/**
 * Fetch models from OpenRouter API (public, no auth required)
 */
async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const response = await fetch(OPENROUTER_MODELS_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch OpenRouter models: HTTP ${response.status} ${response.statusText}`
    );
  }
  const payload = (await response.json()) as { data?: OpenRouterModel[] };
  return payload.data ?? [];
}

/**
 * Discover models from OpenRouter API and upsert them into the models table.
 * Free models are determined by pricing.prompt === "0".
 */
export const discoverOpenRouterModels = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ discovered: number; free: number; paid: number }> => {
    console.log("[modelDiscovery] Starting OpenRouter model discovery...");

    const models = await fetchOpenRouterModels();
    console.log(
      `[modelDiscovery] Found ${models.length} models from OpenRouter API`
    );

    const now = Date.now();
    const modelsToUpsert = models.map((model) => {
      // Free if: id ends with ":free" OR prompt price is "0"
      // Based on OpenClaw's model-scan.ts detection logic
      const isFree =
        model.id.endsWith(":free") ||
        model.pricing?.prompt === "0" ||
        parseFloat(model.pricing?.prompt ?? "1") === 0;

      return {
        name: `openrouter/${model.id}`,
        displayName: model.name || model.id,
        vendor: "openrouter",
        source: "discovered" as const,
        discoveredFrom: "openrouter-api",
        discoveredAt: now,
        requiredApiKeys: isFree ? ([] as string[]) : ["OPENROUTER_API_KEY"],
        tier: isFree ? ("free" as const) : ("paid" as const),
        tags: isFree ? ["free", "discovered"] : ["discovered"],
      };
    });

    if (modelsToUpsert.length > 0) {
      const result = await ctx.runMutation(internal.models.bulkUpsert, {
        models: modelsToUpsert,
      });
      console.log(
        `[modelDiscovery] Upserted ${result.upsertedCount} OpenRouter models`
      );
    }

    const freeCount = modelsToUpsert.filter((m) => m.tier === "free").length;
    return {
      discovered: models.length,
      free: freeCount,
      paid: models.length - freeCount,
    };
  },
});

/**
 * OpenAI model type from their API
 */
interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

/**
 * Fetch models from OpenAI API (requires OPENAI_API_KEY)
 * Returns only models relevant for Codex CLI usage
 */
async function fetchOpenAIModels(apiKey: string): Promise<OpenAIModel[]> {
  const response = await fetch(OPENAI_MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch OpenAI models: HTTP ${response.status} ${response.statusText}`
    );
  }
  const payload = (await response.json()) as { data?: OpenAIModel[] };
  return payload.data ?? [];
}

/**
 * Filter OpenAI models to only include Codex-relevant models.
 * We want GPT models that can be used with Codex CLI.
 */
function isCodexRelevantModel(modelId: string): boolean {
  // Include GPT-5.x models (current generation)
  if (modelId.startsWith("gpt-5")) return true;
  // Include GPT-4.x models for backward compatibility
  if (modelId.startsWith("gpt-4")) return true;
  // Include codex-specific models
  if (modelId.includes("codex")) return true;
  return false;
}

/**
 * Discover models from OpenAI API and upsert them into the models table.
 * Requires OPENAI_API_KEY environment variable.
 * Only discovers GPT/Codex models relevant for agent usage.
 */
export const discoverOpenAIModels = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ discovered: number; codexRelevant: number }> => {
    console.log("[modelDiscovery] Starting OpenAI model discovery...");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn("[modelDiscovery] OPENAI_API_KEY not set, skipping OpenAI discovery");
      return { discovered: 0, codexRelevant: 0 };
    }

    const allModels = await fetchOpenAIModels(apiKey);
    console.log(`[modelDiscovery] Found ${allModels.length} total OpenAI models`);

    // Filter to Codex-relevant models only
    const relevantModels = allModels.filter((m) => isCodexRelevantModel(m.id));
    console.log(`[modelDiscovery] ${relevantModels.length} Codex-relevant models`);

    const now = Date.now();
    const modelsToUpsert = relevantModels.map((model) => {
      // Generate display name from model ID
      const displayName = model.id
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      return {
        name: `codex/${model.id}`,
        displayName,
        vendor: "openai",
        source: "discovered" as const,
        discoveredFrom: "openai-api",
        discoveredAt: now,
        requiredApiKeys: ["OPENAI_API_KEY", "CODEX_AUTH_JSON"],
        tier: "paid" as const,
        tags: ["discovered"],
      };
    });

    if (modelsToUpsert.length > 0) {
      const result = await ctx.runMutation(internal.models.bulkUpsert, {
        models: modelsToUpsert,
      });
      console.log(
        `[modelDiscovery] Upserted ${result.upsertedCount} OpenAI/Codex models`
      );
    }

    return {
      discovered: allModels.length,
      codexRelevant: relevantModels.length,
    };
  },
});

/**
 * Anthropic model type from their API
 */
interface AnthropicModel {
  id: string;
  display_name: string;
  created_at: string;
  type: "model";
}

/**
 * Fetch models from Anthropic API (requires ANTHROPIC_API_KEY)
 */
async function fetchAnthropicModels(apiKey: string): Promise<AnthropicModel[]> {
  const response = await fetch(ANTHROPIC_MODELS_URL, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Anthropic models: HTTP ${response.status} ${response.statusText}`
    );
  }
  const payload = (await response.json()) as { data?: AnthropicModel[] };
  return payload.data ?? [];
}

/**
 * Filter Anthropic models to only include Claude Code relevant models.
 * We want Claude models suitable for agent/coding usage.
 */
function isClaudeCodeRelevantModel(modelId: string): boolean {
  // Include Claude Opus, Sonnet, Haiku (main model families)
  if (modelId.includes("opus")) return true;
  if (modelId.includes("sonnet")) return true;
  if (modelId.includes("haiku")) return true;
  return false;
}

/**
 * Discover models from Anthropic API and upsert them into the models table.
 * Requires ANTHROPIC_API_KEY environment variable.
 * Only discovers Claude models relevant for Claude Code usage.
 */
export const discoverAnthropicModels = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ discovered: number; claudeRelevant: number }> => {
    console.log("[modelDiscovery] Starting Anthropic model discovery...");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn("[modelDiscovery] ANTHROPIC_API_KEY not set, skipping Anthropic discovery");
      return { discovered: 0, claudeRelevant: 0 };
    }

    const allModels = await fetchAnthropicModels(apiKey);
    console.log(`[modelDiscovery] Found ${allModels.length} total Anthropic models`);

    // Filter to Claude Code relevant models only
    const relevantModels = allModels.filter((m) => isClaudeCodeRelevantModel(m.id));
    console.log(`[modelDiscovery] ${relevantModels.length} Claude Code relevant models`);

    const now = Date.now();
    const modelsToUpsert = relevantModels.map((model) => {
      // Map Anthropic model ID to Claude Code naming convention
      // e.g., claude-opus-4-6 -> claude/opus-4.6
      const normalizedId = model.id
        .replace("claude-", "")
        .replace(/-(\d+)-(\d+)/, "-$1.$2"); // Convert claude-opus-4-6 to opus-4.6

      return {
        name: `claude/${normalizedId}`,
        displayName: model.display_name || model.id,
        vendor: "anthropic",
        source: "discovered" as const,
        discoveredFrom: "anthropic-api",
        discoveredAt: now,
        requiredApiKeys: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
        tier: "paid" as const,
        tags: ["discovered"],
      };
    });

    if (modelsToUpsert.length > 0) {
      const result = await ctx.runMutation(internal.models.bulkUpsert, {
        models: modelsToUpsert,
      });
      console.log(
        `[modelDiscovery] Upserted ${result.upsertedCount} Anthropic/Claude models`
      );
    }

    return {
      discovered: allModels.length,
      claudeRelevant: relevantModels.length,
    };
  },
});

/**
 * Seed the models table from the static AGENT_CATALOG.
 * This imports curated models that are defined in code.
 * Also cleans up stale curated models that are no longer in the catalog.
 */
export const seedCuratedModels = internalAction({
  args: {},
  handler: async (ctx): Promise<{ seededCount: number; deletedCount: number }> => {
    console.log("[modelDiscovery] Seeding curated models from AGENT_CATALOG...");

    const modelsToUpsert = AGENT_CATALOG.map((entry, index) => {
      // Get vendor-specific variants or use entry's custom variants
      const variants =
        entry.variants ?? getVariantsForVendor(entry.vendor as AgentVendor);

      return {
        name: entry.name,
        displayName: entry.displayName,
        vendor: entry.vendor,
        source: "curated" as const,
        requiredApiKeys: entry.requiredApiKeys,
        tier: entry.tier,
        tags: entry.tags ?? [],
        sortOrder: index, // Preserve catalog order
        disabled: entry.disabled,
        disabledReason: entry.disabledReason,
        variants,
        defaultVariant: entry.defaultVariant ?? "default",
      };
    });

    // Upsert all curated models
    const result = await ctx.runMutation(internal.models.bulkUpsert, {
      models: modelsToUpsert,
    });

    // Clean up stale curated models no longer in catalog
    const validNames = AGENT_CATALOG.map((e) => e.name);
    const deleteResult = await ctx.runMutation(internal.models.deleteStale, {
      validNames,
      source: "curated",
    });

    if (deleteResult.deletedCount > 0) {
      console.log(
        `[modelDiscovery] Deleted ${deleteResult.deletedCount} stale curated models: ${deleteResult.deletedNames.join(", ")}`
      );
    }

    console.log(
      `[modelDiscovery] Seeded ${result.upsertedCount} curated models, deleted ${deleteResult.deletedCount} stale`
    );

    return {
      seededCount: result.upsertedCount,
      deletedCount: deleteResult.deletedCount,
    };
  },
});

/**
 * Public action to trigger discovery from www routes.
 * Requires authentication.
 */
export const triggerDiscovery = action({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, _args): Promise<{
    success: boolean;
    message: string;
  }> => {
    // Manual auth check for actions
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    // Run internal discovery action
    const discoverResult = await ctx.runAction(
      internal.modelDiscovery.discoverOpencodeModels,
      {}
    );

    return {
      success: true,
      message: `Discovered ${discoverResult.discovered} models (${discoverResult.free} free, ${discoverResult.paid} paid)`,
    };
  },
});

/**
 * Public action to seed curated models from www routes.
 * Requires authentication.
 */
export const triggerSeed = action({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, _args): Promise<{
    success: boolean;
    seededCount: number;
    deletedCount: number;
  }> => {
    // Manual auth check for actions
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    // Run internal seed action
    const result = await ctx.runAction(
      internal.modelDiscovery.seedCuratedModels,
      {}
    );

    return {
      success: true,
      seededCount: result.seededCount,
      deletedCount: result.deletedCount,
    };
  },
});

/**
 * Public action to run full refresh (seed + discover).
 * Requires authentication.
 */
export const triggerRefresh = action({
  args: { teamSlugOrId: v.string() },
  handler: async (
    ctx,
    _args
  ): Promise<{
    success: boolean;
    curated: number;
    discovered: number;
    free: number;
    paid: number;
    openrouter?: { discovered: number; free: number; paid: number };
    openai?: { discovered: number; codexRelevant: number };
    anthropic?: { discovered: number; claudeRelevant: number };
  }> => {
    // Manual auth check for actions
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    // First seed curated models
    const seedResult = await ctx.runAction(
      internal.modelDiscovery.seedCuratedModels,
      {}
    );

    // Discover from OpenCode
    const opcodeResult = await ctx.runAction(
      internal.modelDiscovery.discoverOpencodeModels,
      {}
    );

    // Discover from OpenRouter
    let openrouterResult:
      | { discovered: number; free: number; paid: number }
      | undefined;
    try {
      openrouterResult = await ctx.runAction(
        internal.modelDiscovery.discoverOpenRouterModels,
        {}
      );
    } catch (error) {
      console.error("[modelDiscovery] OpenRouter discovery failed:", error);
    }

    // Discover from OpenAI (Codex models)
    let openaiResult:
      | { discovered: number; codexRelevant: number }
      | undefined;
    try {
      openaiResult = await ctx.runAction(
        internal.modelDiscovery.discoverOpenAIModels,
        {}
      );
    } catch (error) {
      console.error("[modelDiscovery] OpenAI discovery failed:", error);
    }

    // Discover from Anthropic (Claude models)
    let anthropicResult:
      | { discovered: number; claudeRelevant: number }
      | undefined;
    try {
      anthropicResult = await ctx.runAction(
        internal.modelDiscovery.discoverAnthropicModels,
        {}
      );
    } catch (error) {
      console.error("[modelDiscovery] Anthropic discovery failed:", error);
    }

    const totalDiscovered =
      opcodeResult.discovered +
      (openrouterResult?.discovered ?? 0) +
      (openaiResult?.codexRelevant ?? 0) +
      (anthropicResult?.claudeRelevant ?? 0);

    return {
      success: true,
      curated: seedResult.seededCount,
      discovered: totalDiscovered,
      free: opcodeResult.free + (openrouterResult?.free ?? 0),
      paid: opcodeResult.paid + (openrouterResult?.paid ?? 0) +
        (openaiResult?.codexRelevant ?? 0) +
        (anthropicResult?.claudeRelevant ?? 0),
      openrouter: openrouterResult,
      openai: openaiResult,
      anthropic: anthropicResult,
    };
  },
});

/**
 * Internal action: ensure curated models are seeded.
 * Called automatically when listAvailable detects no curated models.
 * This is a self-healing mechanism to prevent empty model lists.
 */
export const ensureCuratedModelsSeeded = internalAction({
  args: {},
  handler: async (ctx): Promise<{ seeded: boolean; count: number }> => {
    // Check if seeding is needed
    const needsSeeding = await ctx.runQuery(internal.models.needsSeeding, {});

    if (!needsSeeding) {
      return { seeded: false, count: 0 };
    }

    console.log(
      "[modelDiscovery] No curated models found, auto-seeding from AGENT_CATALOG..."
    );

    // Run the standard seeding
    const result = await ctx.runAction(
      internal.modelDiscovery.seedCuratedModels,
      {}
    );

    console.log(
      `[modelDiscovery] Auto-seeded ${result.seededCount} curated models`
    );

    return { seeded: true, count: result.seededCount };
  },
});

/**
 * Public action: ensure curated models are seeded (for frontend use).
 * Call this before querying models to ensure the database is populated.
 * Idempotent - safe to call multiple times.
 */
export const ensureModelsSeeded = action({
  args: { teamSlugOrId: v.string() },
  handler: async (
    ctx,
    _args
  ): Promise<{
    seeded: boolean;
    count: number;
    discovered: boolean;
    discoveredCount: number;
  }> => {
    // Require authentication
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    // Ensure curated models are seeded
    const seedResult = await ctx.runAction(
      internal.modelDiscovery.ensureCuratedModelsSeeded,
      {}
    );

    // Also ensure discovered models exist (auto-discovery on first deployment)
    // Wrap in try/catch to prevent discovery failures from breaking the entire seeding flow
    let discoverResult = { discovered: false, count: 0 };
    try {
      discoverResult = await ctx.runAction(
        internal.modelDiscovery.ensureDiscoveredModels,
        {}
      );
    } catch (error) {
      console.error("[modelDiscovery] Discovery failed (continuing with curated models):", error);
    }

    return {
      seeded: seedResult.seeded || discoverResult.discovered,
      count: seedResult.count,
      discovered: discoverResult.discovered,
      discoveredCount: discoverResult.count,
    };
  },
});

/**
 * Internal action: ensure discovered models exist.
 * Called automatically when no discovered models are found.
 * This handles auto-discovery on first deployment.
 */
export const ensureDiscoveredModels = internalAction({
  args: {},
  handler: async (ctx): Promise<{ discovered: boolean; count: number }> => {
    // Check if discovery is needed
    const needsDiscovery = await ctx.runQuery(internal.models.needsDiscovery, {});

    if (!needsDiscovery) {
      return { discovered: false, count: 0 };
    }

    console.log(
      "[modelDiscovery] No discovered models found, auto-discovering from OpenCode..."
    );

    // Run OpenCode discovery (wrapped in try/catch for resilience)
    let opcodeResult = { discovered: 0, free: 0, paid: 0 };
    try {
      opcodeResult = await ctx.runAction(
        internal.modelDiscovery.discoverOpencodeModels,
        {}
      );
      console.log(
        `[modelDiscovery] Auto-discovered ${opcodeResult.discovered} OpenCode models (${opcodeResult.free} free)`
      );
    } catch (error) {
      console.error("[modelDiscovery] OpenCode discovery failed:", error);
    }

    // Also run OpenRouter discovery
    let openrouterCount = 0;
    try {
      const openrouterResult = await ctx.runAction(
        internal.modelDiscovery.discoverOpenRouterModels,
        {}
      );
      openrouterCount = openrouterResult.discovered;
      console.log(
        `[modelDiscovery] Auto-discovered ${openrouterResult.discovered} OpenRouter models (${openrouterResult.free} free)`
      );
    } catch (error) {
      console.error("[modelDiscovery] OpenRouter discovery failed:", error);
    }

    return {
      discovered: true,
      count: opcodeResult.discovered + openrouterCount,
    };
  },
});
