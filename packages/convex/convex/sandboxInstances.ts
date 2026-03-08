/**
 * Unified Sandbox Instance Activity Tracking
 *
 * Provider-agnostic activity tracking for sandbox instances.
 * Supports: morph, pve-lxc, docker, daytona, and future providers.
 *
 * This module replaces the provider-specific morphInstances.ts with a unified
 * approach that works across all sandbox providers.
 */

import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import {
  RUNTIME_PROVIDERS,
  type RuntimeProvider,
  type SnapshotProvider,
} from "@cmux/shared/provider-types";
import { authMutation } from "./users/utils";
import { getTeamId } from "../_shared/team";
import {
  runtimeProviderValidator,
  snapshotProviderValidator,
} from "../_shared/provider-validators";

/**
 * Sandbox provider types - keep in sync with schema.ts
 */
export const SANDBOX_PROVIDERS = RUNTIME_PROVIDERS;

export type SandboxProvider = RuntimeProvider;

/**
 * Detect provider from instance ID prefix
 */
export function detectProviderFromInstanceId(instanceId: string): SandboxProvider {
  if (instanceId.startsWith("morphvm_")) return "morph";
  if (instanceId.startsWith("pvelxc-")) return "pve-lxc";
  if (instanceId.startsWith("docker_")) return "docker";
  if (instanceId.startsWith("daytona_")) return "daytona";
  return "other";
}

/**
 * Get the activity record for a sandbox instance (public query).
 */
export const getActivity = query({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sandboxInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();
  },
});

/**
 * Get the activity record for a sandbox instance (internal, for cron jobs).
 */
export const getActivityInternal = internalQuery({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sandboxInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();
  },
});

/**
 * Get all activity records for a provider (internal, for maintenance crons).
 */
export const listByProviderInternal = internalQuery({
  args: {
    provider: runtimeProviderValidator,
    excludeStopped: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("sandboxInstanceActivity")
      .withIndex("by_provider", (q) => q.eq("provider", args.provider));

    const results = await query.collect();

    // Filter out stopped instances if requested
    if (args.excludeStopped) {
      return results.filter((r) => !r.stoppedAt);
    }

    return results;
  },
});

/**
 * Record that an instance was resumed via the UI.
 * Requires auth and verifies the user belongs to the team that owns the instance.
 */
export const recordResume = authMutation({
  args: {
    instanceId: v.string(),
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify user belongs to this team
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    // Find the taskRun that uses this instance to verify ownership
    const taskRun = await ctx.db
      .query("taskRuns")
      .withIndex("by_vscode_container_name", (q) =>
        q.eq("vscode.containerName", args.instanceId)
      )
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .first();

    if (!taskRun) {
      throw new Error("Instance not found or not authorized");
    }

    const provider = detectProviderFromInstanceId(args.instanceId);

    const existing = await ctx.db
      .query("sandboxInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastResumedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("sandboxInstanceActivity", {
        instanceId: args.instanceId,
        provider,
        lastResumedAt: Date.now(),
        teamId,
        createdAt: Date.now(),
      });
    }
  },
});

/**
 * Record that a sandbox instance was paused (internal, for cron jobs).
 */
export const recordPauseInternal = internalMutation({
  args: {
    instanceId: v.string(),
    provider: v.optional(runtimeProviderValidator),
  },
  handler: async (ctx, args) => {
    const provider = args.provider ?? detectProviderFromInstanceId(args.instanceId);

    const existing = await ctx.db
      .query("sandboxInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastPausedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("sandboxInstanceActivity", {
        instanceId: args.instanceId,
        provider,
        lastPausedAt: Date.now(),
        createdAt: Date.now(),
      });
    }
  },
});

/**
 * Record that a sandbox instance was stopped/deleted (internal, for cron jobs).
 */
export const recordStopInternal = internalMutation({
  args: {
    instanceId: v.string(),
    provider: v.optional(runtimeProviderValidator),
  },
  handler: async (ctx, args) => {
    const provider = args.provider ?? detectProviderFromInstanceId(args.instanceId);

    const existing = await ctx.db
      .query("sandboxInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        stoppedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("sandboxInstanceActivity", {
        instanceId: args.instanceId,
        provider,
        stoppedAt: Date.now(),
        createdAt: Date.now(),
      });
    }
  },
});

/**
 * Create or update activity record when instance is created.
 * Used during sandbox start to initialize tracking.
 */
export const recordCreateInternal = internalMutation({
  args: {
    instanceId: v.string(),
    provider: runtimeProviderValidator,
    vmid: v.optional(v.number()),
    hostname: v.optional(v.string()),
    snapshotId: v.optional(v.string()),
    snapshotProvider: v.optional(snapshotProviderValidator),
    templateVmid: v.optional(v.number()),
    teamId: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sandboxInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();

    if (existing) {
      // Update existing record (shouldn't normally happen)
      await ctx.db.patch(existing._id, {
        teamId: args.teamId,
        userId: args.userId,
        vmid: args.vmid,
        hostname: args.hostname,
        snapshotId: args.snapshotId,
        snapshotProvider: args.snapshotProvider,
        templateVmid: args.templateVmid,
      });
    } else {
      await ctx.db.insert("sandboxInstanceActivity", {
        instanceId: args.instanceId,
        provider: args.provider,
        vmid: args.vmid,
        hostname: args.hostname,
        snapshotId: args.snapshotId,
        snapshotProvider: args.snapshotProvider,
        templateVmid: args.templateVmid,
        teamId: args.teamId,
        userId: args.userId,
        createdAt: Date.now(),
      });
    }
  },
});

/**
 * Record that an instance was created.
 * Called from sandboxes.route.ts after starting a new sandbox.
 * Requires auth and verifies the user belongs to the specified team.
 */
export const recordCreate = authMutation({
  args: {
    instanceId: v.string(),
    provider: runtimeProviderValidator,
    vmid: v.optional(v.number()),
    hostname: v.optional(v.string()),
    snapshotId: v.optional(v.string()),
    snapshotProvider: v.optional(snapshotProviderValidator),
    templateVmid: v.optional(v.number()),
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify user belongs to this team and get team ID
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    // Get user ID from identity subject (Stack Auth user ID)
    const userId = ctx.identity.subject;

    const existing = await ctx.db
      .query("sandboxInstanceActivity")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();

    if (existing) {
      // Update existing record (shouldn't normally happen)
      await ctx.db.patch(existing._id, {
        teamId,
        userId,
        vmid: args.vmid,
        hostname: args.hostname,
        snapshotId: args.snapshotId,
        snapshotProvider: args.snapshotProvider,
        templateVmid: args.templateVmid,
      });
    } else {
      await ctx.db.insert("sandboxInstanceActivity", {
        instanceId: args.instanceId,
        provider: args.provider,
        vmid: args.vmid,
        hostname: args.hostname,
        snapshotId: args.snapshotId,
        snapshotProvider: args.snapshotProvider,
        templateVmid: args.templateVmid,
        teamId,
        userId,
        createdAt: Date.now(),
      });
    }
  },
});

/**
 * Bulk query activity records by instance IDs (internal, for maintenance).
 * Uses batched parallel queries to avoid N+1 pattern.
 */
export const getActivitiesByInstanceIdsInternal = internalQuery({
  args: {
    instanceIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Batch fetch all activities in parallel
    const activities = await Promise.all(
      args.instanceIds.map((instanceId) =>
        ctx.db
          .query("sandboxInstanceActivity")
          .withIndex("by_instanceId", (q) => q.eq("instanceId", instanceId))
          .first()
      )
    );

    const results: Record<
      string,
      {
        instanceId: string;
        provider: SandboxProvider;
        vmid?: number;
        hostname?: string;
        snapshotId?: string;
        snapshotProvider?: SnapshotProvider;
        templateVmid?: number;
        lastPausedAt?: number;
        lastResumedAt?: number;
        stoppedAt?: number;
        teamId?: string;
        userId?: string;
        createdAt?: number;
      }
    > = {};

    for (let i = 0; i < args.instanceIds.length; i++) {
      const activity = activities[i];
      if (activity) {
        results[args.instanceIds[i]] = {
          instanceId: activity.instanceId,
          provider: activity.provider as SandboxProvider,
          vmid: activity.vmid,
          hostname: activity.hostname,
          snapshotId: activity.snapshotId,
          snapshotProvider: activity.snapshotProvider as SnapshotProvider | undefined,
          templateVmid: activity.templateVmid,
          lastPausedAt: activity.lastPausedAt,
          lastResumedAt: activity.lastResumedAt,
          stoppedAt: activity.stoppedAt,
          teamId: activity.teamId,
          userId: activity.userId,
          createdAt: activity.createdAt,
        };
      }
    }

    return results;
  },
});
