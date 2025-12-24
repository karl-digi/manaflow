import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get the activity record for a Morph instance (public query).
 */
export const getActivity = query({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("morphInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();
  },
});

/**
 * Get the activity record for a Morph instance (internal, for cron jobs).
 */
export const getActivityInternal = internalQuery({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("morphInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();
  },
});

/**
 * Record that an instance was resumed via the UI (public mutation).
 */
export const recordResume = mutation({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("morphInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastResumedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("morphInstanceActivity", {
        instanceId: args.instanceId,
        lastResumedAt: Date.now(),
      });
    }
  },
});

/**
 * Record that a Morph instance was paused (internal, for cron jobs).
 */
export const recordPauseInternal = internalMutation({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("morphInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastPausedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("morphInstanceActivity", {
        instanceId: args.instanceId,
        lastPausedAt: Date.now(),
      });
    }
  },
});

/**
 * Record that a Morph instance was stopped (internal, for cron jobs).
 */
export const recordStopInternal = internalMutation({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("morphInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        stoppedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("morphInstanceActivity", {
        instanceId: args.instanceId,
        stoppedAt: Date.now(),
      });
    }
  },
});
