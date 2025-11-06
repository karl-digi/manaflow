import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";

// Default shortcuts that will be populated if user hasn't customized them
export const DEFAULT_SHORTCUTS = [
  {
    shortcutId: "command_palette",
    displayName: "Command Palette",
    description: "Open command palette",
    defaultKeybinding: "Cmd+K",
  },
  {
    shortcutId: "sidebar_toggle",
    displayName: "Toggle Sidebar",
    description: "Show or hide the sidebar",
    defaultKeybinding: "Ctrl+Shift+S",
  },
] as const;

export const getAll = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const customShortcuts = await ctx.db
      .query("keyboardShortcuts")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .collect();

    // Create a map of custom shortcuts by shortcutId
    const customShortcutsMap = new Map(
      customShortcuts.map((s) => [s.shortcutId, s])
    );

    // Merge defaults with custom shortcuts
    const allShortcuts = DEFAULT_SHORTCUTS.map((defaultShortcut) => {
      const custom = customShortcutsMap.get(defaultShortcut.shortcutId);
      if (custom) {
        return {
          ...custom,
          defaultKeybinding: defaultShortcut.defaultKeybinding,
        };
      }
      return {
        ...defaultShortcut,
        keybinding: defaultShortcut.defaultKeybinding,
        _id: undefined, // No DB record yet
        createdAt: undefined,
        updatedAt: undefined,
        userId,
        teamId,
      };
    });

    return allShortcuts;
  },
});

export const getByShortcutId = authQuery({
  args: {
    teamSlugOrId: v.string(),
    shortcutId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const custom = await ctx.db
      .query("keyboardShortcuts")
      .withIndex("by_team_user_shortcutId", (q) =>
        q.eq("teamId", teamId).eq("userId", userId).eq("shortcutId", args.shortcutId)
      )
      .first();

    if (custom) {
      return custom;
    }

    // Return default if no custom shortcut exists
    const defaultShortcut = DEFAULT_SHORTCUTS.find(
      (s) => s.shortcutId === args.shortcutId
    );

    if (defaultShortcut) {
      return {
        ...defaultShortcut,
        keybinding: defaultShortcut.defaultKeybinding,
        _id: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        userId,
        teamId,
      };
    }

    return null;
  },
});

export const upsert = authMutation({
  args: {
    teamSlugOrId: v.string(),
    shortcutId: v.string(),
    displayName: v.string(),
    keybinding: v.string(),
    defaultKeybinding: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const existing = await ctx.db
      .query("keyboardShortcuts")
      .withIndex("by_team_user_shortcutId", (q) =>
        q.eq("teamId", teamId).eq("userId", userId).eq("shortcutId", args.shortcutId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName: args.displayName,
        keybinding: args.keybinding,
        defaultKeybinding: args.defaultKeybinding,
        description: args.description,
        updatedAt: Date.now(),
      });
      return existing._id;
    } else {
      return await ctx.db.insert("keyboardShortcuts", {
        shortcutId: args.shortcutId,
        displayName: args.displayName,
        keybinding: args.keybinding,
        defaultKeybinding: args.defaultKeybinding,
        description: args.description,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        userId,
        teamId,
      });
    }
  },
});

export const resetToDefault = authMutation({
  args: {
    teamSlugOrId: v.string(),
    shortcutId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const existing = await ctx.db
      .query("keyboardShortcuts")
      .withIndex("by_team_user_shortcutId", (q) =>
        q.eq("teamId", teamId).eq("userId", userId).eq("shortcutId", args.shortcutId)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const resetAllToDefaults = authMutation({
  args: {
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const allCustomShortcuts = await ctx.db
      .query("keyboardShortcuts")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .collect();

    for (const shortcut of allCustomShortcuts) {
      await ctx.db.delete(shortcut._id);
    }
  },
});
