import { v } from "convex/values";
import { authMutation } from "./users/utils";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

const environmentValidator = v.union(
  v.literal("development"),
  v.literal("production"),
);

const platformValidator = v.string();

export const upsert = authMutation({
  args: {
    token: v.string(),
    platform: platformValidator,
    environment: environmentValidator,
    bundleId: v.string(),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const now = Date.now();

    if (args.platform !== "ios") {
      throw new Error("Unsupported platform");
    }

    const existing = await ctx.db
      .query("devicePushTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        userId,
        platform: args.platform,
        environment: args.environment,
        bundleId: args.bundleId,
        deviceId: args.deviceId,
        updatedAt: now,
        lastSeenAt: now,
        invalidatedAt: undefined,
        invalidatedReason: undefined,
      });
      return "ok";
    }

    await ctx.db.insert("devicePushTokens", {
      token: args.token,
      userId,
      platform: args.platform,
      environment: args.environment,
      bundleId: args.bundleId,
      deviceId: args.deviceId,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    });

    return "ok";
  },
});

export const remove = authMutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const existing = await ctx.db
      .query("devicePushTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (existing && existing.userId === userId) {
      await ctx.db.delete(existing._id);
    }

    return "ok";
  },
});

export const sendTest = authMutation({
  args: {
    title: v.optional(v.string()),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const title = args.title?.trim() || "cmux test";
    const body = args.body?.trim() || "Push notification from cmux";

    await ctx.scheduler.runAfter(0, internal.pushNotificationsActions.sendTestNotification, {
      userId,
      title,
      body,
    });

    return "ok";
  },
});

export const listActiveTokensForUser = internalQuery({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const tokens = await ctx.db
      .query("devicePushTokens")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return tokens
      .filter((token) => !token.invalidatedAt)
      .map((token) => ({
        token: token.token,
        environment: token.environment,
        bundleId: token.bundleId,
      }));
  },
});

export const getTaskSummary = internalQuery({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    const title = task?.pullRequestTitle?.trim() || task?.text || "Task update";
    return { title };
  },
});

export const markTokenInvalid = internalMutation({
  args: {
    token: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("devicePushTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!existing) {
      return;
    }

    await ctx.db.patch(existing._id, {
      invalidatedAt: Date.now(),
      invalidatedReason: args.reason,
      updatedAt: Date.now(),
    });
  },
});
