// To run migrations:
// bunx convex run migrations:run '{fn: "migrations:setDefaultValue"}'
//
// For backfillTaskRunPullRequests:
// bunx convex run migrations:backfillTaskRunPullRequests

import { v } from "convex/values";
import { Migrations } from "@convex-dev/migrations";
import { internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

export const migrations = new Migrations<DataModel>(components.migrations);

const inferSnapshotProvider = (
  snapshotId: string | undefined,
  templateVmid: number | undefined
): "morph" | "pve-lxc" | "pve-vm" | undefined => {
  if (!snapshotId) {
    return templateVmid !== undefined ? "pve-lxc" : undefined;
  }

  if (snapshotId.startsWith("snapshot_")) {
    return templateVmid !== undefined ? "pve-lxc" : "morph";
  }

  return undefined;
};

const inferSnapshotProviderFromLegacy = (
  snapshotId: string | undefined,
  morphSnapshotId: string | undefined,
  templateVmid: number | undefined
): "morph" | "pve-lxc" | "pve-vm" | undefined => {
  if (morphSnapshotId) {
    if (morphSnapshotId.startsWith("pve_lxc_")) {
      return "pve-lxc";
    }
    if (morphSnapshotId.startsWith("snapshot_")) {
      return "morph";
    }
  }

  return inferSnapshotProvider(snapshotId, templateVmid);
};

// Backfill snapshotProvider from snapshotId/template metadata where possible.
// Run with: bunx convex run migrations:run '{fn: "migrations:backfillEnvironmentsSnapshotFields"}'
export const backfillEnvironmentsSnapshotFields = migrations.define({
  table: "environments",
  migrateOne: (_ctx, doc) => {
    const updates: Partial<typeof doc> = {};
    const normalizedSnapshotId = doc.snapshotId;

    if (doc.snapshotProvider === undefined) {
      const provider = inferSnapshotProvider(
        normalizedSnapshotId,
        doc.templateVmid
      );
      if (provider) {
        updates.snapshotProvider = provider;
      }
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    return updates;
  },
});

// Run with: bunx convex run migrations:run '{fn: "migrations:backfillEnvironmentSnapshotVersionsSnapshotFields"}'
export const backfillEnvironmentSnapshotVersionsSnapshotFields =
  migrations.define({
    table: "environmentSnapshotVersions",
    migrateOne: (_ctx, doc) => {
      const updates: Partial<typeof doc> = {};
      const normalizedSnapshotId = doc.snapshotId;

      if (doc.snapshotProvider === undefined) {
        const provider = inferSnapshotProvider(
          normalizedSnapshotId,
          doc.templateVmid
        );
        if (provider) {
          updates.snapshotProvider = provider;
        }
      }

      if (Object.keys(updates).length === 0) {
        return;
      }

      return updates;
    },
  });

// Copy legacy morphSnapshotId to snapshotId, infer snapshotProvider, then drop morphSnapshotId.
// Run with: bunx convex run migrations:run '{fn: "migrations:backfillEnvironmentSnapshotVersionsMorphSnapshotId"}'
export const backfillEnvironmentSnapshotVersionsMorphSnapshotId =
  migrations.define({
    table: "environmentSnapshotVersions",
    migrateOne: (_ctx, doc) => {
      const legacy = doc as typeof doc & { morphSnapshotId?: string };
      if (legacy.morphSnapshotId === undefined) {
        return;
      }

      const updates: Partial<typeof doc> & { morphSnapshotId?: undefined } = {
        morphSnapshotId: undefined,
      };

      if (doc.snapshotId === undefined && legacy.morphSnapshotId) {
        updates.snapshotId = legacy.morphSnapshotId;
      }

      if (doc.snapshotProvider === undefined) {
        const provider = inferSnapshotProviderFromLegacy(
          updates.snapshotId ?? doc.snapshotId,
          legacy.morphSnapshotId,
          doc.templateVmid
        );
        if (provider) {
          updates.snapshotProvider = provider;
        }
      }

      return updates;
    },
  });

// Backfill teams.teamId from legacy teams.uuid when missing
export const backfillTeamsTeamId = migrations.define({
  table: "teams",
  migrateOne: (_ctx, doc) => {
    const d = doc as unknown as { teamId?: string } & Record<string, unknown>;
    if (d.teamId === undefined) {
      const legacy = (d as Record<string, unknown>)["uuid"];
      if (typeof legacy === "string") {
        return { teamId: legacy } as Partial<typeof doc>;
      }
    }
  },
});

// Backfill users.userId from legacy users.uuid when missing
export const backfillUsersUserId = migrations.define({
  table: "users",
  migrateOne: (_ctx, doc) => {
    const d = doc as unknown as { userId?: string } & Record<string, unknown>;
    if (d.userId === undefined) {
      const legacy = (d as Record<string, unknown>)["uuid"];
      if (typeof legacy === "string") {
        return { userId: legacy } as Partial<typeof doc>;
      }
    }
  },
});

export const dropUsersUuid = migrations.define({
  table: "users",
  migrateOne: (_ctx, doc) => {
    return { userId: doc.userId, uuid: undefined } as Partial<typeof doc>;
  },
});

export const dropTeamsUuid = migrations.define({
  table: "teams",
  migrateOne: (_ctx, doc) => {
    return { teamId: doc.teamId, uuid: undefined } as Partial<typeof doc>;
  },
});

// Remove deprecated CLI output logs retained on historical task runs
export const clearTaskRunsLog = migrations.define({
  table: "taskRuns",
  migrateOne: (_ctx, doc) => {
    if (doc.log === undefined) {
      return;
    }
    return { log: undefined };
  },
});

// Remove deprecated crownModel and crownSystemPrompt fields from workspaceSettings
export const dropWorkspaceSettingsCrownFields = migrations.define({
  table: "workspaceSettings",
  migrateOne: (_ctx, doc) => {
    const d = doc as unknown as Record<string, unknown>;
    if (d.crownModel !== undefined || d.crownSystemPrompt !== undefined) {
      return { crownModel: undefined, crownSystemPrompt: undefined } as Partial<
        typeof doc
      >;
    }
  },
});

// Backfill tasks.lastActivityAt from createdAt (or latest taskRun createdAt)
// Run with: bunx convex run migrations:backfillTasksLastActivityAt
export const backfillTasksLastActivityAt = migrations.define({
  table: "tasks",
  migrateOne: async (ctx, doc) => {
    if (doc.lastActivityAt !== undefined) {
      return; // Already set
    }

    // Find the latest taskRun for this task to get more accurate lastActivityAt
    const latestRun = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", doc._id))
      .order("desc")
      .first();

    // Use latest run's createdAt if available, otherwise task's createdAt
    const lastActivityAt = latestRun?.createdAt ?? doc.createdAt ?? Date.now();

    return { lastActivityAt };
  },
});

// Backfill unreadTaskRuns.taskId from the taskRunId's taskId
// Run with: bunx convex run migrations:backfillUnreadTaskRunsTaskId
export const backfillUnreadTaskRunsTaskId = migrations.define({
  table: "unreadTaskRuns",
  migrateOne: async (ctx, doc) => {
    // Check if taskId is already set (using type assertion since schema now requires it)
    const d = doc as unknown as { taskId?: unknown };
    if (d.taskId !== undefined) {
      return; // Already set
    }

    // Look up the taskRun to get taskId
    const taskRun = await ctx.db.get(doc.taskRunId);
    if (!taskRun) {
      // TaskRun was deleted, delete this orphaned unread row
      await ctx.db.delete(doc._id);
      return;
    }

    return { taskId: taskRun.taskId };
  },
});

// Generic runner; choose migrations from CLI or dashboard when invoking
export const run = migrations.runner();

/**
 * Backfill the taskRunPullRequests junction table from existing taskRuns.pullRequests arrays.
 * This is a one-time migration to populate the junction table for efficient PR webhook lookups.
 *
 * Run with: bunx convex run migrations:backfillTaskRunPullRequests
 *
 * This schedules itself to continue processing if there are more documents,
 * avoiding the 16MB read limit per function execution.
 * It's idempotent - running it multiple times won't create duplicate entries.
 */
export const backfillTaskRunPullRequests = internalMutation({
  handler: async (ctx) => {
    let totalProcessed = 0;
    let totalInserted = 0;
    const batchSize = 50; // Small batch to stay under limits

    const results = await ctx.db
      .query("taskRuns")
      .paginate({ cursor: null, numItems: batchSize });

    for (const run of results.page) {
      if (!run.pullRequests || run.pullRequests.length === 0) {
        continue;
      }

      for (const pr of run.pullRequests) {
        if (pr.number === undefined) {
          continue;
        }

        // Check if entry already exists by querying the junction table
        // We query by the unique combination of taskRunId + PR identity
        const existingEntries = await ctx.db
          .query("taskRunPullRequests")
          .withIndex("by_task_run", (q) => q.eq("taskRunId", run._id))
          .collect();

        const alreadyExists = existingEntries.some(
          (e) =>
            e.repoFullName === pr.repoFullName && e.prNumber === pr.number,
        );

        if (!alreadyExists) {
          await ctx.db.insert("taskRunPullRequests", {
            taskRunId: run._id,
            teamId: run.teamId,
            repoFullName: pr.repoFullName,
            prNumber: pr.number,
            createdAt: Date.now(),
          });
          totalInserted++;
        }
      }
      totalProcessed++;
    }

    console.log(
      `[backfillTaskRunPullRequests] Batch complete. Processed ${totalProcessed} taskRuns, inserted ${totalInserted} entries. isDone=${results.isDone}`,
    );

    // Schedule next batch if there's more data
    if (!results.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillTaskRunPullRequestsContinue,
        { cursor: results.continueCursor },
      );
    }

    return { totalProcessed, totalInserted, isDone: results.isDone };
  },
});

/**
 * Continue backfilling from a cursor. Called by backfillTaskRunPullRequests.
 */
export const backfillTaskRunPullRequestsContinue = internalMutation({
  args: {
    cursor: v.string(),
  },
  handler: async (ctx, { cursor }) => {
    let totalProcessed = 0;
    let totalInserted = 0;
    const batchSize = 50;

    const results = await ctx.db
      .query("taskRuns")
      .paginate({ cursor, numItems: batchSize });

    for (const run of results.page) {
      if (!run.pullRequests || run.pullRequests.length === 0) {
        continue;
      }

      for (const pr of run.pullRequests) {
        if (pr.number === undefined) {
          continue;
        }

        const existingEntries = await ctx.db
          .query("taskRunPullRequests")
          .withIndex("by_task_run", (q) => q.eq("taskRunId", run._id))
          .collect();

        const alreadyExists = existingEntries.some(
          (e) =>
            e.repoFullName === pr.repoFullName && e.prNumber === pr.number,
        );

        if (!alreadyExists) {
          await ctx.db.insert("taskRunPullRequests", {
            taskRunId: run._id,
            teamId: run.teamId,
            repoFullName: pr.repoFullName,
            prNumber: pr.number,
            createdAt: Date.now(),
          });
          totalInserted++;
        }
      }
      totalProcessed++;
    }

    console.log(
      `[backfillTaskRunPullRequests] Batch complete. Processed ${totalProcessed} taskRuns, inserted ${totalInserted} entries. isDone=${results.isDone}`,
    );

    // Schedule next batch if there's more data
    if (!results.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillTaskRunPullRequestsContinue,
        { cursor: results.continueCursor },
      );
    }

    return { totalProcessed, totalInserted, isDone: results.isDone };
  },
});

// Normalize isArchived and isPreview fields on tasks to enable efficient index queries.
// Sets undefined values to false so the by_team_user_active index can be used.
// Run with: bunx convex run migrations:run '{fn: "migrations:normalizeTaskBooleanFields"}'
export const normalizeTaskBooleanFields = migrations.define({
  table: "tasks",
  migrateOne: (_ctx, doc) => {
    const updates: Partial<typeof doc> = {};

    // Normalize isArchived: undefined -> false
    if (doc.isArchived === undefined) {
      updates.isArchived = false;
    }

    // Normalize isPreview: undefined -> false
    if (doc.isPreview === undefined) {
      updates.isPreview = false;
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    return updates;
  },
});

// Backfill selectedTaskRunId for existing tasks.
// Sets it to the crowned run if one exists, otherwise the latest non-archived run.
// Run with: bunx convex run migrations:run '{fn: "migrations:backfillTasksSelectedTaskRunId"}'
export const backfillTasksSelectedTaskRunId = migrations.define({
  table: "tasks",
  migrateOne: async (ctx, doc) => {
    // Skip if already set
    if (doc.selectedTaskRunId !== undefined) {
      return;
    }

    // Find crowned run first
    const crownedRun = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", doc._id))
      .filter((q) => q.eq(q.field("isCrowned"), true))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .first();

    if (crownedRun) {
      return { selectedTaskRunId: crownedRun._id };
    }

    // Fall back to latest non-archived run
    const latestRun = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", doc._id))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .order("desc")
      .first();

    if (latestRun) {
      return { selectedTaskRunId: latestRun._id };
    }

    // No runs found, leave undefined
    return;
  },
});
