/**
 * Daytona sandbox instance management.
 * Separate from devboxInstances to avoid conflicts with Morph-based devbox.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { authQuery, authMutation } from "./users/utils";
import { getTeamId } from "../_shared/team";

const instanceStatusValidator = v.union(
  v.literal("running"),
  v.literal("paused"),
  v.literal("stopped"),
  v.literal("archived"),
  v.literal("starting"),
  v.literal("stopping"),
  v.literal("error"),
  v.literal("unknown")
);

/**
 * Generate a friendly ID for CLI users (cmux_xxxxxxxx)
 */
function generateDaytonaId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "cmux_";
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  for (let i = 0; i < 8; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

/**
 * List Daytona instances for the authenticated user in a team.
 */
export const list = authQuery({
  args: {
    teamSlugOrId: v.string(),
    includeStoppedAfter: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    const instancesQuery = ctx.db
      .query("daytonaInstances")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .order("desc");

    const rawInstances = await instancesQuery.collect();

    // Filter based on stopped status
    if (args.includeStoppedAfter !== undefined) {
      return rawInstances.filter((instance) => {
        if (instance.status === "stopped" && instance.stoppedAt) {
          return instance.stoppedAt >= args.includeStoppedAfter!;
        }
        return true;
      });
    }

    // By default, exclude stopped instances
    return rawInstances.filter((instance) => instance.status !== "stopped");
  },
});

/**
 * Get a specific Daytona instance by ID (dbox_xxxxxxxx).
 */
export const getById = authQuery({
  args: {
    teamSlugOrId: v.string(),
    id: v.string(), // The daytonaId (dbox_xxx)
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    const instance = await ctx.db
      .query("daytonaInstances")
      .withIndex("by_daytonaId", (q) => q.eq("daytonaId", args.id))
      .first();

    // Verify ownership
    if (!instance || instance.teamId !== teamId || instance.userId !== userId) {
      return null;
    }

    return instance;
  },
});

/**
 * Internal query to get instance by ID (for HTTP handlers).
 */
export const getByIdInternal = internalQuery({
  args: {
    id: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("daytonaInstances")
      .withIndex("by_daytonaId", (q) => q.eq("daytonaId", args.id))
      .first();
  },
});

/**
 * Get the provider info for a Daytona instance.
 */
export const getInfo = internalQuery({
  args: {
    daytonaId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("daytonaInfo")
      .withIndex("by_daytonaId", (q) => q.eq("daytonaId", args.daytonaId))
      .first();
  },
});

/**
 * Get Daytona ID from provider sandbox ID.
 */
export const getDaytonaIdFromProvider = internalQuery({
  args: {
    providerSandboxId: v.string(),
  },
  handler: async (ctx, args) => {
    const info = await ctx.db
      .query("daytonaInfo")
      .withIndex("by_providerSandboxId", (q) =>
        q.eq("providerSandboxId", args.providerSandboxId)
      )
      .first();
    return info?.daytonaId ?? null;
  },
});

/**
 * Create a new Daytona instance record with provider info.
 */
export const create = authMutation({
  args: {
    teamSlugOrId: v.string(),
    providerSandboxId: v.string(), // Daytona sandbox ID
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
    source: v.optional(v.union(v.literal("cli"), v.literal("web"))),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    // Check if info for this provider sandbox already exists
    const existingInfo = await ctx.db
      .query("daytonaInfo")
      .withIndex("by_providerSandboxId", (q) =>
        q.eq("providerSandboxId", args.providerSandboxId)
      )
      .first();

    if (existingInfo) {
      // Instance already exists, update it
      const existing = await ctx.db
        .query("daytonaInstances")
        .withIndex("by_daytonaId", (q) => q.eq("daytonaId", existingInfo.daytonaId))
        .first();

      if (existing) {
        // Security: Verify ownership before allowing reuse
        if (existing.userId !== userId || existing.teamId !== teamId) {
          throw new Error(
            "Sandbox already exists and belongs to a different user/team"
          );
        }

        const now = Date.now();
        await ctx.db.patch(existing._id, {
          status: "running",
          name: args.name ?? existing.name,
          metadata: args.metadata ?? existing.metadata,
          updatedAt: now,
          lastAccessedAt: now,
        });
        return { id: existing.daytonaId, isExisting: true };
      }
    }

    const now = Date.now();
    const daytonaId = generateDaytonaId();

    // Create the Daytona instance (user-facing data only)
    await ctx.db.insert("daytonaInstances", {
      daytonaId,
      userId,
      teamId,
      name: args.name,
      source: args.source,
      status: "running",
      metadata: args.metadata,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
    });

    // Create the provider info (Daytona-specific data)
    await ctx.db.insert("daytonaInfo", {
      daytonaId,
      providerSandboxId: args.providerSandboxId,
      image: args.image,
      createdAt: now,
    });

    return { id: daytonaId, isExisting: false };
  },
});

/**
 * Update the status of a Daytona instance by ID.
 */
export const updateStatus = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.string(), // The daytonaId
    status: instanceStatusValidator,
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    const instance = await ctx.db
      .query("daytonaInstances")
      .withIndex("by_daytonaId", (q) => q.eq("daytonaId", args.id))
      .first();

    if (!instance || instance.teamId !== teamId || instance.userId !== userId) {
      throw new Error("Instance not found or not authorized");
    }

    const now = Date.now();
    const updates: {
      status: typeof args.status;
      updatedAt: number;
      stoppedAt?: number;
      lastAccessedAt?: number;
    } = {
      status: args.status,
      updatedAt: now,
    };

    if (args.status === "stopped") {
      updates.stoppedAt = now;
    } else if (args.status === "running") {
      updates.lastAccessedAt = now;
    }

    await ctx.db.patch(instance._id, updates);
  },
});

/**
 * Record access for a Daytona instance by ID.
 */
export const recordAccess = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.string(), // The daytonaId
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    const instance = await ctx.db
      .query("daytonaInstances")
      .withIndex("by_daytonaId", (q) => q.eq("daytonaId", args.id))
      .first();

    if (!instance || instance.teamId !== teamId || instance.userId !== userId) {
      throw new Error("Instance not found or not authorized");
    }

    await ctx.db.patch(instance._id, {
      lastAccessedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Internal mutation to update instance status (for cron jobs or internal use).
 */
export const updateStatusInternal = internalMutation({
  args: {
    providerSandboxId: v.string(),
    status: instanceStatusValidator,
  },
  handler: async (ctx, args) => {
    // Look up Daytona ID from provider info
    const info = await ctx.db
      .query("daytonaInfo")
      .withIndex("by_providerSandboxId", (q) =>
        q.eq("providerSandboxId", args.providerSandboxId)
      )
      .first();

    if (!info) {
      return; // Instance not tracked, nothing to do
    }

    const instance = await ctx.db
      .query("daytonaInstances")
      .withIndex("by_daytonaId", (q) => q.eq("daytonaId", info.daytonaId))
      .first();

    if (!instance) {
      return;
    }

    const now = Date.now();
    const updates: {
      status: typeof args.status;
      updatedAt: number;
      stoppedAt?: number;
    } = {
      status: args.status,
      updatedAt: now,
    };

    if (args.status === "stopped") {
      updates.stoppedAt = now;
    }

    await ctx.db.patch(instance._id, updates);
  },
});

/**
 * Delete a Daytona instance by ID.
 */
export const remove = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.string(), // The daytonaId
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    const instance = await ctx.db
      .query("daytonaInstances")
      .withIndex("by_daytonaId", (q) => q.eq("daytonaId", args.id))
      .first();

    if (!instance || instance.teamId !== teamId || instance.userId !== userId) {
      throw new Error("Instance not found or not authorized");
    }

    // Also delete the provider info
    const info = await ctx.db
      .query("daytonaInfo")
      .withIndex("by_daytonaId", (q) => q.eq("daytonaId", args.id))
      .first();

    if (info) {
      await ctx.db.delete(info._id);
    }

    await ctx.db.delete(instance._id);
  },
});
