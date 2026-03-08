import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { internalQuery } from "./_generated/server";
import { authMutation, authQuery } from "./users/utils";

/**
 * Sanitize branch prefix to prevent shell injection.
 * Only allows safe git-ref characters: alphanumeric, forward slash, hyphen, underscore, dot.
 * Strips any other characters and limits length.
 */
function sanitizeBranchPrefix(prefix: string): string {
  // Remove any characters that aren't safe for git refs and shell interpolation
  // Allowed: a-z, A-Z, 0-9, /, -, _, .
  const sanitized = prefix
    .replace(/[^a-zA-Z0-9/_.-]/g, "")
    .substring(0, 50); // Limit length
  return sanitized;
}

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
    autoSyncEnabled: v.optional(v.boolean()),
    bypassAnthropicProxy: v.optional(v.boolean()),
    branchPrefix: v.optional(v.string()),
    worktreeMode: v.optional(
      v.union(v.literal("legacy"), v.literal("codex-style"))
    ),
    codexWorktreePathPattern: v.optional(v.string()),
    heatmapModel: v.optional(v.string()),
    heatmapThreshold: v.optional(v.number()),
    heatmapTooltipLanguage: v.optional(v.string()),
    heatmapColors: v.optional(
      v.object({
        line: v.object({ start: v.string(), end: v.string() }),
        token: v.object({ start: v.string(), end: v.string() }),
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

    if (existing) {
      const updates: {
        worktreePath?: string;
        autoPrEnabled?: boolean;
        autoSyncEnabled?: boolean;
        bypassAnthropicProxy?: boolean;
        branchPrefix?: string;
        worktreeMode?: "legacy" | "codex-style";
        codexWorktreePathPattern?: string;
        heatmapModel?: string;
        heatmapThreshold?: number;
        heatmapTooltipLanguage?: string;
        heatmapColors?: {
          line: { start: string; end: string };
          token: { start: string; end: string };
        };
        updatedAt: number;
      } = { updatedAt: now };

      if (args.worktreePath !== undefined) {
        updates.worktreePath = args.worktreePath;
      }
      if (args.autoPrEnabled !== undefined) {
        updates.autoPrEnabled = args.autoPrEnabled;
      }
      if (args.autoSyncEnabled !== undefined) {
        updates.autoSyncEnabled = args.autoSyncEnabled;
      }
      if (args.bypassAnthropicProxy !== undefined) {
        updates.bypassAnthropicProxy = args.bypassAnthropicProxy;
      }
      if (args.branchPrefix !== undefined) {
        updates.branchPrefix = sanitizeBranchPrefix(args.branchPrefix);
      }
      if (args.worktreeMode !== undefined) {
        updates.worktreeMode = args.worktreeMode;
      }
      if (args.codexWorktreePathPattern !== undefined) {
        updates.codexWorktreePathPattern = args.codexWorktreePathPattern;
      }
      if (args.heatmapModel !== undefined) {
        updates.heatmapModel = args.heatmapModel;
      }
      if (args.heatmapThreshold !== undefined) {
        updates.heatmapThreshold = args.heatmapThreshold;
      }
      if (args.heatmapTooltipLanguage !== undefined) {
        updates.heatmapTooltipLanguage = args.heatmapTooltipLanguage;
      }
      if (args.heatmapColors !== undefined) {
        updates.heatmapColors = args.heatmapColors;
      }

      await ctx.db.patch(existing._id, updates);
    } else {
      await ctx.db.insert("workspaceSettings", {
        worktreePath: args.worktreePath,
        autoPrEnabled: args.autoPrEnabled,
        autoSyncEnabled: args.autoSyncEnabled,
        bypassAnthropicProxy: args.bypassAnthropicProxy,
        branchPrefix: args.branchPrefix !== undefined ? sanitizeBranchPrefix(args.branchPrefix) : undefined,
        worktreeMode: args.worktreeMode,
        codexWorktreePathPattern: args.codexWorktreePathPattern,
        heatmapModel: args.heatmapModel,
        heatmapThreshold: args.heatmapThreshold,
        heatmapTooltipLanguage: args.heatmapTooltipLanguage,
        heatmapColors: args.heatmapColors,
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
