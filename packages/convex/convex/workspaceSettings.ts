import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { internalQuery } from "./_generated/server";
import { authMutation, authQuery } from "./users/utils";

export const get = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const settings = await ctx.db
      .query("workspaceSettings")
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
    worktreePath: v.optional(v.string()),
    autoPrEnabled: v.optional(v.boolean()),
    shortcuts: v.optional(
      v.object({
        commandPalette: v.optional(v.union(v.string(), v.null())),
        sidebarToggle: v.optional(v.union(v.string(), v.null())),
        previewReload: v.optional(v.union(v.string(), v.null())),
        previewBack: v.optional(v.union(v.string(), v.null())),
        previewForward: v.optional(v.union(v.string(), v.null())),
        previewFocusAddress: v.optional(v.union(v.string(), v.null())),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const existing = await ctx.db
      .query("workspaceSettings")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .first();
    const now = Date.now();

    const normalizeShortcuts = (input:
      | Partial<{
          commandPalette: string | null;
          sidebarToggle: string | null;
          previewReload: string | null;
          previewBack: string | null;
          previewForward: string | null;
          previewFocusAddress: string | null;
        }>
      | undefined
    ):
      | Partial<{
          commandPalette: string | null;
          sidebarToggle: string | null;
          previewReload: string | null;
          previewBack: string | null;
          previewForward: string | null;
          previewFocusAddress: string | null;
        }>
      | undefined => {
      if (!input) return undefined;
      const result: Partial<{
        commandPalette: string | null;
        sidebarToggle: string | null;
        previewReload: string | null;
        previewBack: string | null;
        previewForward: string | null;
        previewFocusAddress: string | null;
      }> = {};
      let hasAny = false;
      const entries: Array<
        [
          keyof typeof result,
          string | null | undefined,
        ]
      > = [
        ["commandPalette", input.commandPalette],
        ["sidebarToggle", input.sidebarToggle],
        ["previewReload", input.previewReload],
        ["previewBack", input.previewBack],
        ["previewForward", input.previewForward],
        ["previewFocusAddress", input.previewFocusAddress],
      ];
      for (const [key, raw] of entries) {
        if (raw === undefined) continue;
        if (raw === null) {
          result[key] = null;
          hasAny = true;
          continue;
        }
        const trimmed = raw.trim();
        result[key] = trimmed.length > 0 ? trimmed : null;
        hasAny = true;
      }
      return hasAny ? result : undefined;
    };

    const normalizedShortcuts = normalizeShortcuts(args.shortcuts ?? undefined);

    if (existing) {
      const updates: {
        worktreePath?: string;
        autoPrEnabled?: boolean;
        shortcuts?: Partial<{
          commandPalette: string | null;
          sidebarToggle: string | null;
          previewReload: string | null;
          previewBack: string | null;
          previewForward: string | null;
          previewFocusAddress: string | null;
        }>;
        updatedAt: number;
      } = { updatedAt: now };

      if (args.worktreePath !== undefined) {
        updates.worktreePath = args.worktreePath;
      }
      if (args.autoPrEnabled !== undefined) {
        updates.autoPrEnabled = args.autoPrEnabled;
      }
      if (normalizedShortcuts !== undefined) {
        updates.shortcuts = normalizedShortcuts;
      }

      await ctx.db.patch(existing._id, updates);
    } else {
      await ctx.db.insert("workspaceSettings", {
        worktreePath: args.worktreePath,
        autoPrEnabled: args.autoPrEnabled,
        ...(normalizedShortcuts ? { shortcuts: normalizedShortcuts } : {}),
        nextLocalWorkspaceSequence: 0,
        createdAt: now,
        updatedAt: now,
        userId,
        teamId,
      });
    }
  },
});

export const getByTeamAndUserInternal = internalQuery({
  args: { teamId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("workspaceSettings")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", args.userId)
      )
      .first();
    return settings ?? null;
  },
});
