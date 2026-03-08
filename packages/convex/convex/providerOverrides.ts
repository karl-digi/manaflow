/**
 * Provider Override operations for per-team customization of AI providers.
 *
 * Enables teams to:
 * - Configure custom proxy endpoints (AnyRouter, Antigravity, etc.)
 * - Override API formats (anthropic, openai, bedrock, vertex, passthrough)
 * - Set custom headers for authentication/routing
 * - Define fallback chains for rate limit handling
 */

import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { internalMutation, internalQuery } from "./_generated/server";
import { authMutation, authQuery } from "./users/utils";

// Validator for API format enum
const apiFormatValidator = v.union(
  v.literal("anthropic"),
  v.literal("openai"),
  v.literal("bedrock"),
  v.literal("vertex"),
  v.literal("passthrough")
);

// Validator for fallback configuration
const fallbackValidator = v.object({
  modelName: v.string(),
  priority: v.number(),
});

/**
 * Get all provider overrides for a team.
 */
export const getForTeam = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const overrides = await ctx.db
      .query("providerOverrides")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .collect();
    return overrides;
  },
});

/**
 * Get a specific provider override by team and provider ID.
 */
export const getByProvider = authQuery({
  args: {
    teamSlugOrId: v.string(),
    providerId: v.string(),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const override = await ctx.db
      .query("providerOverrides")
      .withIndex("by_team_provider", (q) =>
        q.eq("teamId", teamId).eq("providerId", args.providerId)
      )
      .first();
    return override ?? null;
  },
});

/**
 * Upsert a provider override configuration.
 * Creates a new override if one doesn't exist, otherwise updates the existing one.
 */
export const upsert = authMutation({
  args: {
    teamSlugOrId: v.string(),
    providerId: v.string(),
    baseUrl: v.optional(v.string()),
    apiFormat: v.optional(apiFormatValidator),
    apiKeyEnvVar: v.optional(v.string()),
    customHeaders: v.optional(v.record(v.string(), v.string())),
    fallbacks: v.optional(v.array(fallbackValidator)),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const now = Date.now();

    // Check for existing override
    const existing = await ctx.db
      .query("providerOverrides")
      .withIndex("by_team_provider", (q) =>
        q.eq("teamId", teamId).eq("providerId", args.providerId)
      )
      .first();

    if (existing) {
      // Update existing override
      await ctx.db.patch(existing._id, {
        baseUrl: args.baseUrl,
        apiFormat: args.apiFormat,
        apiKeyEnvVar: args.apiKeyEnvVar,
        customHeaders: args.customHeaders,
        fallbacks: args.fallbacks,
        enabled: args.enabled,
        updatedAt: now,
      });
      return { id: existing._id, action: "updated" as const };
    } else {
      // Create new override
      const id = await ctx.db.insert("providerOverrides", {
        teamId,
        providerId: args.providerId,
        baseUrl: args.baseUrl,
        apiFormat: args.apiFormat,
        apiKeyEnvVar: args.apiKeyEnvVar,
        customHeaders: args.customHeaders,
        fallbacks: args.fallbacks,
        enabled: args.enabled,
        createdAt: now,
        updatedAt: now,
      });
      return { id, action: "created" as const };
    }
  },
});

/**
 * Remove a provider override.
 */
export const remove = authMutation({
  args: {
    teamSlugOrId: v.string(),
    providerId: v.string(),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const existing = await ctx.db
      .query("providerOverrides")
      .withIndex("by_team_provider", (q) =>
        q.eq("teamId", teamId).eq("providerId", args.providerId)
      )
      .first();

    if (!existing) {
      throw new Error(
        `Provider override not found: ${args.providerId} for team ${args.teamSlugOrId}`
      );
    }

    await ctx.db.delete(existing._id);
    return { success: true };
  },
});

/**
 * Toggle the enabled state of a provider override.
 */
export const setEnabled = authMutation({
  args: {
    teamSlugOrId: v.string(),
    providerId: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const existing = await ctx.db
      .query("providerOverrides")
      .withIndex("by_team_provider", (q) =>
        q.eq("teamId", teamId).eq("providerId", args.providerId)
      )
      .first();

    if (!existing) {
      throw new Error(
        `Provider override not found: ${args.providerId} for team ${args.teamSlugOrId}`
      );
    }

    await ctx.db.patch(existing._id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Internal query to resolve provider configuration for a team.
 * Used by the agent spawner to get provider settings.
 */
export const resolveProviderConfig = internalQuery({
  args: {
    teamId: v.string(),
    providerId: v.string(),
  },
  handler: async (ctx, args) => {
    const override = await ctx.db
      .query("providerOverrides")
      .withIndex("by_team_provider", (q) =>
        q.eq("teamId", args.teamId).eq("providerId", args.providerId)
      )
      .first();

    if (!override || !override.enabled) {
      return null;
    }

    return {
      baseUrl: override.baseUrl,
      apiFormat: override.apiFormat,
      apiKeyEnvVar: override.apiKeyEnvVar,
      customHeaders: override.customHeaders,
      fallbacks: override.fallbacks,
    };
  },
});

/**
 * Internal query to get all enabled provider overrides for a team.
 * Used by the agent spawner to build provider configurations.
 */
export const getAllEnabledForTeam = internalQuery({
  args: {
    teamId: v.string(),
  },
  handler: async (ctx, args) => {
    const overrides = await ctx.db
      .query("providerOverrides")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();

    return overrides.filter((o) => o.enabled);
  },
});

/**
 * Internal mutation to remove a provider override by team ID.
 * Used for cleanup/migration scripts.
 */
export const removeByTeamId = internalMutation({
  args: {
    teamId: v.string(),
    providerId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("providerOverrides")
      .withIndex("by_team_provider", (q) =>
        q.eq("teamId", args.teamId).eq("providerId", args.providerId)
      )
      .first();

    if (!existing) {
      return { success: false, message: "Provider override not found" };
    }

    await ctx.db.delete(existing._id);
    return { success: true };
  },
});
