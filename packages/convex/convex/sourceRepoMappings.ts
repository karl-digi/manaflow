import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";

/**
 * Source repo mappings for Codex-style worktrees.
 * Maps project full names (e.g., "owner/repo") to local filesystem paths.
 */

export const list = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    return await ctx.db
      .query("sourceRepoMappings")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .collect();
  },
});

export const getByProject = authQuery({
  args: {
    teamSlugOrId: v.string(),
    projectFullName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    return await ctx.db
      .query("sourceRepoMappings")
      .withIndex("by_team_user_project", (q) =>
        q
          .eq("teamId", teamId)
          .eq("userId", userId)
          .eq("projectFullName", args.projectFullName)
      )
      .first();
  },
});

export const upsert = authMutation({
  args: {
    teamSlugOrId: v.string(),
    projectFullName: v.string(),
    localRepoPath: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const now = Date.now();

    // Check if mapping already exists
    const existing = await ctx.db
      .query("sourceRepoMappings")
      .withIndex("by_team_user_project", (q) =>
        q
          .eq("teamId", teamId)
          .eq("userId", userId)
          .eq("projectFullName", args.projectFullName)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        localRepoPath: args.localRepoPath,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("sourceRepoMappings", {
      projectFullName: args.projectFullName,
      localRepoPath: args.localRepoPath,
      createdAt: now,
      updatedAt: now,
      userId,
      teamId,
    });
  },
});

export const remove = authMutation({
  args: {
    teamSlugOrId: v.string(),
    projectFullName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const existing = await ctx.db
      .query("sourceRepoMappings")
      .withIndex("by_team_user_project", (q) =>
        q
          .eq("teamId", teamId)
          .eq("userId", userId)
          .eq("projectFullName", args.projectFullName)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const updateVerifiedAt = authMutation({
  args: {
    teamSlugOrId: v.string(),
    projectFullName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const now = Date.now();

    const existing = await ctx.db
      .query("sourceRepoMappings")
      .withIndex("by_team_user_project", (q) =>
        q
          .eq("teamId", teamId)
          .eq("userId", userId)
          .eq("projectFullName", args.projectFullName)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastVerifiedAt: now,
        updatedAt: now,
      });
    }
  },
});
