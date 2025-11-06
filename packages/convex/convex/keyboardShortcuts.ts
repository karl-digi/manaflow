import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";

export const get = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const settings = await ctx.db
      .query("keyboardShortcuts")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .first();
    return settings ?? null;
  },
});

export const update = authMutation({
  args: {
    teamSlugOrId: v.string(),
    commandPalette: v.optional(v.string()),
    toggleSidebar: v.optional(v.string()),
    reloadPreview: v.optional(v.string()),
    focusPreviewAddressBar: v.optional(v.string()),
    previewBack: v.optional(v.string()),
    previewForward: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const existing = await ctx.db
      .query("keyboardShortcuts")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .first();
    const now = Date.now();

    if (existing) {
      const updates: {
        commandPalette?: string;
        toggleSidebar?: string;
        reloadPreview?: string;
        focusPreviewAddressBar?: string;
        previewBack?: string;
        previewForward?: string;
        updatedAt: number;
      } = { updatedAt: now };

      if (args.commandPalette !== undefined) {
        updates.commandPalette = args.commandPalette;
      }
      if (args.toggleSidebar !== undefined) {
        updates.toggleSidebar = args.toggleSidebar;
      }
      if (args.reloadPreview !== undefined) {
        updates.reloadPreview = args.reloadPreview;
      }
      if (args.focusPreviewAddressBar !== undefined) {
        updates.focusPreviewAddressBar = args.focusPreviewAddressBar;
      }
      if (args.previewBack !== undefined) {
        updates.previewBack = args.previewBack;
      }
      if (args.previewForward !== undefined) {
        updates.previewForward = args.previewForward;
      }

      await ctx.db.patch(existing._id, updates);
    } else {
      await ctx.db.insert("keyboardShortcuts", {
        commandPalette: args.commandPalette,
        toggleSidebar: args.toggleSidebar,
        reloadPreview: args.reloadPreview,
        focusPreviewAddressBar: args.focusPreviewAddressBar,
        previewBack: args.previewBack,
        previewForward: args.previewForward,
        createdAt: now,
        updatedAt: now,
        userId,
        teamId,
      });
    }
  },
});
