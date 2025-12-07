import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// Script type validator for reuse
const scriptValidator = v.object({
  name: v.string(),
  command: v.string(),
  description: v.optional(v.string()),
});

// Get workspace config by repo ID
export const getWorkspaceConfig = query({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaceConfigs")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .first();
  },
});

// Create or update workspace config
export const upsertWorkspaceConfig = mutation({
  args: {
    repoId: v.id("repos"),
    setupScripts: v.array(scriptValidator),
    devScripts: v.array(scriptValidator),
    maintenanceScripts: v.array(scriptValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaceConfigs")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        setupScripts: args.setupScripts,
        devScripts: args.devScripts,
        maintenanceScripts: args.maintenanceScripts,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("workspaceConfigs", {
      repoId: args.repoId,
      setupScripts: args.setupScripts,
      devScripts: args.devScripts,
      maintenanceScripts: args.maintenanceScripts,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update only dev scripts
export const updateDevScripts = mutation({
  args: {
    repoId: v.id("repos"),
    devScripts: v.array(scriptValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaceConfigs")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        devScripts: args.devScripts,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("workspaceConfigs", {
      repoId: args.repoId,
      setupScripts: [],
      devScripts: args.devScripts,
      maintenanceScripts: [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update only maintenance scripts
export const updateMaintenanceScripts = mutation({
  args: {
    repoId: v.id("repos"),
    maintenanceScripts: v.array(scriptValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaceConfigs")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        maintenanceScripts: args.maintenanceScripts,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("workspaceConfigs", {
      repoId: args.repoId,
      setupScripts: [],
      devScripts: [],
      maintenanceScripts: args.maintenanceScripts,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update only setup scripts
export const updateSetupScripts = mutation({
  args: {
    repoId: v.id("repos"),
    setupScripts: v.array(scriptValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaceConfigs")
      .withIndex("by_repoId", (q) => q.eq("repoId", args.repoId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        setupScripts: args.setupScripts,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("workspaceConfigs", {
      repoId: args.repoId,
      setupScripts: args.setupScripts,
      devScripts: [],
      maintenanceScripts: [],
      createdAt: now,
      updatedAt: now,
    });
  },
});
