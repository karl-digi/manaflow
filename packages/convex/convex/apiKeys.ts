import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { internalQuery } from "./_generated/server";
import { authMutation, authQuery } from "./users/utils";

export const getAll = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    return await ctx.db
      .query("apiKeys")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .collect();
  },
});

export const getByEnvVar = authQuery({
  args: {
    teamSlugOrId: v.string(),
    envVar: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    return await ctx.db
      .query("apiKeys")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("envVar"), args.envVar))
      .first();
  },
});

export const upsert = authMutation({
  args: {
    teamSlugOrId: v.string(),
    envVar: v.string(),
    value: v.string(),
    displayName: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const existing = await ctx.db
      .query("apiKeys")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("envVar"), args.envVar))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.value,
        displayName: args.displayName,
        description: args.description,
        updatedAt: Date.now(),
      });
      return existing._id;
    } else {
      return await ctx.db.insert("apiKeys", {
        envVar: args.envVar,
        value: args.value,
        displayName: args.displayName,
        description: args.description,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        userId,
        teamId,
      });
    }
  },
});

export const remove = authMutation({
  args: {
    teamSlugOrId: v.string(),
    envVar: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const existing = await ctx.db
      .query("apiKeys")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("envVar"), args.envVar))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const getAllForAgents = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const apiKeys = await ctx.db
      .query("apiKeys")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .collect();
    const keyMap: Record<string, string> = {};

    for (const key of apiKeys) {
      keyMap[key.envVar] = key.value;
    }

    return keyMap;
  },
});

export const getAllForAgentsInternal = internalQuery({
  args: {
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKeys = await ctx.db
      .query("apiKeys")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", args.userId)
      )
      .collect();

    const keyMap: Record<string, string> = {};
    for (const key of apiKeys) {
      keyMap[key.envVar] = key.value;
    }
    return keyMap;
  },
});
