import { v } from "convex/values";

import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";

export const get = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const preference = await ctx.db
      .query("releasePreferences")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .first();

    return preference ?? null;
  },
});

export const update = authMutation({
  args: {
    teamSlugOrId: v.string(),
    allowPrerelease: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const existing = await ctx.db
      .query("releasePreferences")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .first();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        allowPrerelease: args.allowPrerelease,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("releasePreferences", {
        allowPrerelease: args.allowPrerelease,
        createdAt: now,
        updatedAt: now,
        userId,
        teamId,
      });
    }
  },
});
