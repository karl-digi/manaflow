import { v } from "convex/values";
import { getTeamId } from "../_shared/team";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type QueryCtx } from "./_generated/server";
import { authMutation, authQuery } from "./users/utils";

type AcpStatus = "pending" | "running" | "completed" | "error";

async function ensureThreadBelongsToTeam(
  ctx: QueryCtx,
  threadId: Id<"acpThreads">,
  teamId: string
) {
  const thread = await ctx.db.get(threadId);
  if (!thread) {
    throw new Error("ACP thread not found");
  }
  if (thread.teamId !== teamId) {
    throw new Error("ACP thread does not belong to this team");
  }
  return thread;
}

export const listThreads = authQuery({
  args: {
    teamSlugOrId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const limit = args.limit ?? 50;

    const threads = await ctx.db
      .query("acpThreads")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .order("desc")
      .take(limit);

    return threads;
  },
});

export const getThreadMessages = authQuery({
  args: {
    teamSlugOrId: v.string(),
    threadId: v.id("acpThreads"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    await ensureThreadBelongsToTeam(ctx, args.threadId, teamId);

    const limit = args.limit ?? 200;
    const messages = await ctx.db
      .query("acpMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(limit);

    return messages.reverse();
  },
});

export const createThread = authMutation({
  args: {
    teamSlugOrId: v.string(),
    provider: v.string(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const userId = ctx.identity.subject;
    const now = Date.now();

    const threadId = await ctx.db.insert("acpThreads", {
      teamId,
      userId,
      provider: args.provider,
      sessionId: undefined,
      title: args.title,
      status: "pending",
      lastStopReason: undefined,
      errorMessage: undefined,
      createdAt: now,
      updatedAt: now,
    });

    return { threadId };
  },
});

export const ingestFromWorker = internalMutation({
  args: {
    provider: v.string(),
    teamId: v.string(),
    userId: v.string(),
    threadId: v.optional(v.id("acpThreads")),
    sessionId: v.optional(v.string()),
    threadUpdate: v.optional(
      v.object({
        sessionId: v.optional(v.string()),
        status: v.optional(
          v.union(
            v.literal("pending"),
            v.literal("running"),
            v.literal("completed"),
            v.literal("error")
          )
        ),
        lastStopReason: v.optional(v.string()),
        errorMessage: v.optional(v.string()),
        title: v.optional(v.string()),
      })
    ),
    messages: v.optional(
      v.array(
        v.object({
          kind: v.union(
            v.literal("prompt"),
            v.literal("update"),
            v.literal("stop"),
            v.literal("error")
          ),
          role: v.union(
            v.literal("user"),
            v.literal("agent"),
            v.literal("tool"),
            v.literal("system")
          ),
          payload: v.any(),
          sessionUpdateType: v.optional(v.string()),
          sequence: v.optional(v.number()),
          createdAt: v.optional(v.number()),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const teamId = args.teamId;
    const userId = args.userId;

    let threadId: Id<"acpThreads"> | undefined = args.threadId;
    if (!threadId && args.sessionId) {
      const existing = await ctx.db
        .query("acpThreads")
        .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
        .filter((q) => q.eq(q.field("teamId"), teamId))
        .first();
      if (existing) {
        threadId = existing._id;
      }
    }

    if (threadId) {
      const thread = await ctx.db.get(threadId);
      if (!thread) {
        throw new Error("ACP thread not found");
      }
      if (thread.teamId !== teamId) {
        throw new Error("ACP thread team mismatch");
      }
    }

    if (!threadId) {
      threadId = await ctx.db.insert("acpThreads", {
        teamId,
        userId,
        provider: args.provider,
        sessionId: args.threadUpdate?.sessionId ?? args.sessionId,
        title: args.threadUpdate?.title,
        status: (args.threadUpdate?.status ?? "running") as AcpStatus,
        lastStopReason: args.threadUpdate?.lastStopReason,
        errorMessage: args.threadUpdate?.errorMessage,
        createdAt: now,
        updatedAt: now,
      });
    } else if (args.threadUpdate) {
      await ctx.db.patch(threadId, {
        sessionId: args.threadUpdate.sessionId ?? undefined,
        status: (args.threadUpdate.status ??
          (await ctx.db.get(threadId))?.status ??
          "running") as AcpStatus,
        lastStopReason: args.threadUpdate.lastStopReason,
        errorMessage: args.threadUpdate.errorMessage,
        title: args.threadUpdate.title,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(threadId, { updatedAt: now });
    }

    if (args.messages && args.messages.length > 0) {
      if (!threadId) {
        throw new Error("ACP thread missing for message ingestion");
      }

      const latest = await ctx.db
        .query("acpMessages")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .order("desc")
        .first();
      let nextSequence = latest ? latest.sequence + 1 : 0;

      for (const msg of args.messages) {
        const sequence =
          msg.sequence !== undefined ? msg.sequence : nextSequence++;
        const createdAt = msg.createdAt ?? Date.now();
        await ctx.db.insert("acpMessages", {
          threadId,
          teamId,
          userId,
          provider: args.provider,
          role: msg.role,
          kind: msg.kind,
          sessionUpdateType: msg.sessionUpdateType,
          sequence,
          content: msg.payload,
          createdAt,
        });
      }
    }

    return { threadId };
  },
});
