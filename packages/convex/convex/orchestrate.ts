import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { authMutation, authQuery } from "./users/utils";

/**
 * Send a message to a running agent via the mailbox.
 * Messages are stored in the agentOrchestrateMessages table and can be
 * synced to the agent's MAILBOX.json via the memory sync endpoint.
 *
 * Requires authentication. User must own the task run.
 */
export const sendMessage = authMutation({
  args: {
    taskRunId: v.id("taskRuns"),
    message: v.string(),
    messageType: v.union(
      v.literal("handoff"),
      v.literal("request"),
      v.literal("status")
    ),
    senderName: v.string(),
    recipientName: v.optional(v.string()), // Agent name or "*" for broadcast
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const taskRunId = args.taskRunId;
    const userId = ctx.identity.subject;

    // Verify task run exists and user owns it
    const taskRun = await ctx.db.get(taskRunId);
    if (!taskRun) {
      throw new Error("Task run not found");
    }
    if (taskRun.userId !== userId) {
      throw new Error("Forbidden: You don't own this task run");
    }

    // Generate unique message ID using crypto.randomUUID for collision resistance
    const messageId = `msg_${crypto.randomUUID()}`;

    // Store message in agentOrchestrateMessages table
    await ctx.db.insert("agentOrchestrateMessages", {
      taskRunId,
      teamId: taskRun.teamId,
      userId: taskRun.userId,
      messageId,
      messageType: args.messageType,
      senderName: args.senderName,
      recipientName: args.recipientName ?? "*",
      content: args.message,
      read: false,
      timestamp: args.timestamp,
      createdAt: Date.now(),
    });

    return {
      ok: true,
      messageId,
    };
  },
});

/**
 * Get messages for a specific task run.
 * Used by the memory sync endpoint to include messages in MAILBOX.json updates.
 *
 * Requires authentication. User must own the task run.
 */
export const getMessages = authQuery({
  args: {
    taskRunId: v.id("taskRuns"),
    includeRead: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;

    // Verify task run exists and user owns it
    const taskRun = await ctx.db.get(args.taskRunId);
    if (!taskRun) {
      throw new Error("Task run not found");
    }
    if (taskRun.userId !== userId) {
      throw new Error("Forbidden: You don't own this task run");
    }

    const query = args.includeRead
      ? ctx.db
          .query("agentOrchestrateMessages")
          .withIndex("by_task_run", (q) => q.eq("taskRunId", args.taskRunId))
      : ctx.db
          .query("agentOrchestrateMessages")
          .withIndex("by_task_run_unread", (q) =>
            q.eq("taskRunId", args.taskRunId).eq("read", false)
          );

    const messages = await query.collect();

    return messages.map((m) => ({
      id: m.messageId,
      from: m.senderName,
      to: m.recipientName,
      type: m.messageType,
      message: m.content,
      timestamp: new Date(m.timestamp).toISOString(),
      read: m.read,
    }));
  },
});

/**
 * Mark a message as read.
 *
 * Requires authentication. User must own the task run.
 */
export const markMessageRead = authMutation({
  args: {
    taskRunId: v.id("taskRuns"),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;

    // Verify task run exists and user owns it
    const taskRun = await ctx.db.get(args.taskRunId);
    if (!taskRun) {
      throw new Error("Task run not found");
    }
    if (taskRun.userId !== userId) {
      throw new Error("Forbidden: You don't own this task run");
    }

    const messages = await ctx.db
      .query("agentOrchestrateMessages")
      .withIndex("by_task_run", (q) => q.eq("taskRunId", args.taskRunId))
      .filter((q) => q.eq(q.field("messageId"), args.messageId))
      .collect();

    if (messages.length === 0) {
      throw new Error(`Message ${args.messageId} not found`);
    }

    await ctx.db.patch(messages[0]._id, { read: true });

    return { ok: true };
  },
});

/**
 * Internal mutation to send messages from the orchestration worker.
 * Used when the worker needs to deliver messages without user auth context.
 */
export const sendMessageInternal = internalMutation({
  args: {
    taskRunId: v.id("taskRuns"),
    message: v.string(),
    messageType: v.union(
      v.literal("handoff"),
      v.literal("request"),
      v.literal("status")
    ),
    senderName: v.string(),
    recipientName: v.optional(v.string()),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const taskRun = await ctx.db.get(args.taskRunId);
    if (!taskRun) {
      throw new Error("Task run not found");
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await ctx.db.insert("agentOrchestrateMessages", {
      taskRunId: args.taskRunId,
      teamId: taskRun.teamId,
      userId: taskRun.userId,
      messageId,
      messageType: args.messageType,
      senderName: args.senderName,
      recipientName: args.recipientName ?? "*",
      content: args.message,
      read: false,
      timestamp: args.timestamp,
      createdAt: Date.now(),
    });

    return { ok: true, messageId };
  },
});

/**
 * Internal query to get messages for sync operations.
 */
export const getMessagesInternal = internalQuery({
  args: {
    taskRunId: v.id("taskRuns"),
    includeRead: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const query = args.includeRead
      ? ctx.db
          .query("agentOrchestrateMessages")
          .withIndex("by_task_run", (q) => q.eq("taskRunId", args.taskRunId))
      : ctx.db
          .query("agentOrchestrateMessages")
          .withIndex("by_task_run_unread", (q) =>
            q.eq("taskRunId", args.taskRunId).eq("read", false)
          );

    const messages = await query.collect();

    return messages.map((m) => ({
      id: m.messageId,
      from: m.senderName,
      to: m.recipientName,
      type: m.messageType,
      message: m.content,
      timestamp: new Date(m.timestamp).toISOString(),
      read: m.read,
    }));
  },
});
