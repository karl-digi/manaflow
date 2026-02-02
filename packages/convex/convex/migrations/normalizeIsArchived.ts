/**
 * Migration to normalize isArchived field on tasks table.
 * Converts undefined -> false so we can efficiently use the by_team_user_archived index.
 *
 * Run this migration after deploying the schema update that adds the
 * by_team_user_archived index.
 *
 * Usage:
 *   1. Deploy schema with new index: bun run convex:deploy
 *   2. Run migration until complete:
 *      bunx convex run migrations/normalizeIsArchived:migrateTasksIsArchived
 *   3. Repeat step 2 until it returns { processed: 0, hasMore: false }
 */
import { internalMutation } from "../_generated/server";

/**
 * Batch migration to normalize isArchived field on tasks.
 * Processes 100 tasks at a time to avoid transaction timeouts.
 *
 * @returns { processed: number, hasMore: boolean }
 *   - processed: number of tasks updated in this batch
 *   - hasMore: true if more batches remain
 */
export const migrateTasksIsArchived = internalMutation({
  handler: async (ctx) => {
    // Find tasks where isArchived is undefined (not yet normalized)
    const tasks = await ctx.db
      .query("tasks")
      .filter((q) => q.eq(q.field("isArchived"), undefined))
      .take(100);

    const now = Date.now();
    for (const task of tasks) {
      await ctx.db.patch(task._id, { isArchived: false, updatedAt: now });
    }

    return { processed: tasks.length, hasMore: tasks.length === 100 };
  },
});

/**
 * Batch migration to normalize isArchived field on taskRuns.
 * Processes 100 taskRuns at a time to avoid transaction timeouts.
 *
 * @returns { processed: number, hasMore: boolean }
 *   - processed: number of taskRuns updated in this batch
 *   - hasMore: true if more batches remain
 */
export const migrateTaskRunsIsArchived = internalMutation({
  handler: async (ctx) => {
    // Find taskRuns where isArchived is undefined (not yet normalized)
    const taskRuns = await ctx.db
      .query("taskRuns")
      .filter((q) => q.eq(q.field("isArchived"), undefined))
      .take(100);

    const now = Date.now();
    for (const run of taskRuns) {
      await ctx.db.patch(run._id, { isArchived: false, updatedAt: now });
    }

    return { processed: taskRuns.length, hasMore: taskRuns.length === 100 };
  },
});
