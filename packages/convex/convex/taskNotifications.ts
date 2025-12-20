import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { authMutation, authQuery } from "./users/utils";

// Get all notifications for the current user (paginated, newest first)
export const list = authQuery({
  args: {
    teamSlugOrId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const take = Math.max(1, Math.min(args.limit ?? 50, 100));

    const notifications = await ctx.db
      .query("taskNotifications")
      .withIndex("by_team_user_created", (q) =>
        q.eq("teamId", teamId).eq("userId", userId),
      )
      .order("desc")
      .take(take);

    // Fetch associated tasks for display
    const taskIds = [...new Set(notifications.map((n) => n.taskId))];
    const tasks = await Promise.all(taskIds.map((id) => ctx.db.get(id)));
    const taskMap = new Map(
      tasks.filter(Boolean).map((t) => [t!._id, t!]),
    );

    // Fetch associated task runs for display
    const runIds = notifications
      .filter((n) => n.taskRunId)
      .map((n) => n.taskRunId as Id<"taskRuns">);
    const runs = await Promise.all(runIds.map((id) => ctx.db.get(id)));
    const runMap = new Map(
      runs.filter(Boolean).map((r) => [r!._id, r!]),
    );

    return notifications.map((n) => ({
      ...n,
      task: taskMap.get(n.taskId) ?? null,
      taskRun: n.taskRunId ? (runMap.get(n.taskRunId) ?? null) : null,
    }));
  },
});

// Get unread notification count
export const getUnreadCount = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Query for unread notifications (readAt is undefined)
    const unreadNotifications = await ctx.db
      .query("taskNotifications")
      .withIndex("by_team_user_unread", (q) =>
        q.eq("teamId", teamId).eq("userId", userId).eq("readAt", undefined),
      )
      .collect();

    return unreadNotifications.length;
  },
});

// Get tasks with unread notifications (for sidebar dots)
export const getTasksWithUnread = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Query for unread notifications
    const unreadNotifications = await ctx.db
      .query("taskNotifications")
      .withIndex("by_team_user_unread", (q) =>
        q.eq("teamId", teamId).eq("userId", userId).eq("readAt", undefined),
      )
      .collect();

    // Group by taskId and get the most recent notification per task
    const taskNotificationMap = new Map<
      Id<"tasks">,
      { count: number; latestCreatedAt: number }
    >();

    for (const n of unreadNotifications) {
      const existing = taskNotificationMap.get(n.taskId);
      if (!existing) {
        taskNotificationMap.set(n.taskId, {
          count: 1,
          latestCreatedAt: n.createdAt,
        });
      } else {
        existing.count++;
        if (n.createdAt > existing.latestCreatedAt) {
          existing.latestCreatedAt = n.createdAt;
        }
      }
    }

    // Convert to array format
    const result: Array<{
      taskId: Id<"tasks">;
      unreadCount: number;
      latestNotificationAt: number;
    }> = [];

    for (const [taskId, data] of taskNotificationMap) {
      result.push({
        taskId,
        unreadCount: data.count,
        latestNotificationAt: data.latestCreatedAt,
      });
    }

    return result;
  },
});

// Mark a single notification as read
export const markAsRead = authMutation({
  args: {
    teamSlugOrId: v.string(),
    notificationId: v.id("taskNotifications"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.teamId !== teamId || notification.userId !== userId) {
      throw new Error("Notification not found or unauthorized");
    }

    if (!notification.readAt) {
      await ctx.db.patch(args.notificationId, {
        readAt: Date.now(),
      });
    }
  },
});

// Mark all notifications for a task as read
export const markTaskAsRead = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Get all unread notifications for this task
    const unreadNotifications = await ctx.db
      .query("taskNotifications")
      .withIndex("by_task_user_unread", (q) =>
        q.eq("taskId", args.taskId).eq("userId", userId).eq("readAt", undefined),
      )
      .collect();

    const now = Date.now();
    for (const n of unreadNotifications) {
      if (n.teamId === teamId) {
        await ctx.db.patch(n._id, { readAt: now });
      }
    }
  },
});

// Mark all notifications as read
export const markAllAsRead = authMutation({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const unreadNotifications = await ctx.db
      .query("taskNotifications")
      .withIndex("by_team_user_unread", (q) =>
        q.eq("teamId", teamId).eq("userId", userId).eq("readAt", undefined),
      )
      .collect();

    const now = Date.now();
    for (const n of unreadNotifications) {
      await ctx.db.patch(n._id, { readAt: now });
    }
  },
});

// Internal mutation to create a notification (called from taskRuns on completion)
export const createInternal = internalMutation({
  args: {
    taskId: v.id("tasks"),
    taskRunId: v.optional(v.id("taskRuns")),
    teamId: v.string(),
    userId: v.string(),
    type: v.union(v.literal("run_completed"), v.literal("run_failed")),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("taskNotifications", {
      taskId: args.taskId,
      taskRunId: args.taskRunId,
      teamId: args.teamId,
      userId: args.userId,
      type: args.type,
      message: args.message,
      createdAt: Date.now(),
    });
  },
});

// Internal query to check if a task has unread notifications
export const hasUnreadForTaskInternal = internalQuery({
  args: {
    taskId: v.id("tasks"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const notification = await ctx.db
      .query("taskNotifications")
      .withIndex("by_task_user_unread", (q) =>
        q.eq("taskId", args.taskId).eq("userId", args.userId).eq("readAt", undefined),
      )
      .first();

    return notification !== null;
  },
});
