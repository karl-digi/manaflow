import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";

/**
 * Get model preferences for the current user in the specified team.
 * Returns disabledModels array (empty if no preferences set).
 */
export const get = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const preferences = await ctx.db
      .query("modelPreferences")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .first();
    return preferences ?? { disabledModels: [] };
  },
});

/**
 * Update the entire disabledModels array for the current user in the specified team.
 */
export const update = authMutation({
  args: {
    teamSlugOrId: v.string(),
    disabledModels: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const existing = await ctx.db
      .query("modelPreferences")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .first();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        disabledModels: args.disabledModels,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("modelPreferences", {
        disabledModels: args.disabledModels,
        createdAt: now,
        updatedAt: now,
        userId,
        teamId,
      });
    }
  },
});

/**
 * Toggle a single model on or off for the current user in the specified team.
 * If enabled=true, removes from disabledModels (model will be shown).
 * If enabled=false, adds to disabledModels (model will be hidden).
 */
export const toggleModel = authMutation({
  args: {
    teamSlugOrId: v.string(),
    agentName: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const existing = await ctx.db
      .query("modelPreferences")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .first();
    const now = Date.now();

    const currentDisabled = existing?.disabledModels ?? [];
    let newDisabled: string[];

    if (args.enabled) {
      // Remove from disabled list (enable the model)
      newDisabled = currentDisabled.filter((name) => name !== args.agentName);
    } else {
      // Add to disabled list if not already there (disable the model)
      if (currentDisabled.includes(args.agentName)) {
        newDisabled = currentDisabled;
      } else {
        newDisabled = [...currentDisabled, args.agentName];
      }
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        disabledModels: newDisabled,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("modelPreferences", {
        disabledModels: newDisabled,
        createdAt: now,
        updatedAt: now,
        userId,
        teamId,
      });
    }
  },
});
