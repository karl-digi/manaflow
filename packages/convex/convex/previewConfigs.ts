import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";
import { internalQuery } from "./_generated/server";

function normalizeRepoFullName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes("/")) {
    throw new Error("repoFullName must be in the form owner/name");
  }
  return trimmed.replace(/\.git$/i, "").toLowerCase();
}

export const listByTeam = authQuery({
  args: {
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const configs = await ctx.db
      .query("previewConfigs")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .order("desc")
      .collect();
    return configs;
  },
});

export const get = authQuery({
  args: {
    teamSlugOrId: v.string(),
    previewConfigId: v.id("previewConfigs"),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const config = await ctx.db.get(args.previewConfigId);
    if (!config || config.teamId !== teamId) {
      return null;
    }
    return config;
  },
});

export const getByRepo = authQuery({
  args: {
    teamSlugOrId: v.string(),
    repoFullName: v.string(),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const repoFullName = normalizeRepoFullName(args.repoFullName);
    const config = await ctx.db
      .query("previewConfigs")
      .withIndex("by_team_repo", (q) =>
        q.eq("teamId", teamId).eq("repoFullName", repoFullName),
      )
      .first();
    return config ?? null;
  },
});

export const remove = authMutation({
  args: {
    teamSlugOrId: v.string(),
    previewConfigId: v.id("previewConfigs"),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const config = await ctx.db.get(args.previewConfigId);
    if (!config || config.teamId !== teamId) {
      throw new Error("Preview config not found");
    }
    await ctx.db.delete(args.previewConfigId);
    return { id: args.previewConfigId };
  },
});

export const upsert = authMutation({
  args: {
    teamSlugOrId: v.string(),
    repoFullName: v.string(),
    environmentId: v.optional(v.id("environments")),
    repoInstallationId: v.optional(v.number()),
    repoDefaultBranch: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("paused"),
        v.literal("disabled"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    if (!userId) {
      throw new Error("Authentication required");
    }
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const repoFullName = normalizeRepoFullName(args.repoFullName);
    const now = Date.now();

    // Verify environment exists and belongs to team if provided
    if (args.environmentId) {
      const environment = await ctx.db.get(args.environmentId);
      if (!environment || environment.teamId !== teamId) {
        throw new Error("Environment not found");
      }
    }

    const existing = await ctx.db
      .query("previewConfigs")
      .withIndex("by_team_repo", (q) =>
        q.eq("teamId", teamId).eq("repoFullName", repoFullName),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        environmentId: args.environmentId ?? existing.environmentId,
        repoInstallationId: args.repoInstallationId ?? existing.repoInstallationId,
        repoDefaultBranch: args.repoDefaultBranch ?? existing.repoDefaultBranch,
        status: args.status ?? existing.status ?? "active",
        updatedAt: now,
      });
      return existing._id;
    }

    const id = await ctx.db.insert("previewConfigs", {
      teamId,
      createdByUserId: userId,
      repoFullName,
      repoProvider: "github",
      environmentId: args.environmentId,
      repoInstallationId: args.repoInstallationId,
      repoDefaultBranch: args.repoDefaultBranch,
      status: args.status ?? "active",
      lastRunAt: undefined,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

export const getByTeamAndRepo = internalQuery({
  args: {
    teamId: v.string(),
    repoFullName: v.string(),
  },
  handler: async (ctx, args) => {
    const repoFullName = normalizeRepoFullName(args.repoFullName);
    const config = await ctx.db
      .query("previewConfigs")
      .withIndex("by_team_repo", (q) =>
        q.eq("teamId", args.teamId).eq("repoFullName", repoFullName),
      )
      .first();
    return config ?? null;
  },
});

export const getByRepoAndInstallation = internalQuery({
  args: {
    repoFullName: v.string(),
    repoInstallationId: v.number(),
    teamId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const repoFullName = normalizeRepoFullName(args.repoFullName);
    // Get all preview configs for this repo across all teams
    const configs = await ctx.db
      .query("previewConfigs")
      .withIndex("by_repo", (q) => q.eq("repoFullName", repoFullName))
      .collect();

    // Filter to configs that match the installation ID
    const matchingConfigs = configs.filter(
      (c) => c.repoInstallationId === args.repoInstallationId,
    );

    if (matchingConfigs.length === 0) {
      return null;
    }

    // SECURITY: Verify that the team owning each config has a providerConnection
    // with this installation. This prevents unauthorized teams from hijacking webhooks.
    for (const config of matchingConfigs) {
      // Check if this team has a providerConnection with this installation
      const teamConnection = await ctx.db
        .query("providerConnections")
        .withIndex("by_team", (q) => q.eq("teamId", config.teamId))
        .filter((q) =>
          q.eq(q.field("installationId"), args.repoInstallationId),
        )
        .first();

      if (teamConnection) {
        // This team legitimately has access to the installation
        return config;
      }
    }

    // No valid config found - all matching configs are from teams without
    // legitimate access to this installation
    return null;
  },
});
