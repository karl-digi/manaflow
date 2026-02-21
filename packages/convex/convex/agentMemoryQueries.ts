import { v } from "convex/values";
import { getTeamId } from "../_shared/team";
import { authQuery } from "./users/utils";

/**
 * Get the latest knowledge memory snapshot for a team.
 * Used for cross-run memory seeding - new sandboxes get previous run's knowledge.
 *
 * Returns the most recent "knowledge" type snapshot content, or null if none exists.
 */
export const getLatestTeamKnowledge = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    // Query the most recent knowledge snapshot for this team
    // Uses by_team_type index with createdAt for ordering
    const snapshot = await ctx.db
      .query("agentMemorySnapshots")
      .withIndex("by_team_type", (q) =>
        q.eq("teamId", teamId).eq("memoryType", "knowledge")
      )
      .order("desc")
      .first();

    if (!snapshot) {
      return null;
    }

    // Return content if it's non-empty and substantial
    const content = snapshot.content?.trim();
    if (!content || content.length < 50) {
      // If content is too short, it's probably just the template
      return null;
    }

    return snapshot.content;
  },
});

/**
 * Get all memory snapshots for a specific task run.
 * Used by the Memory Viewer UI panel to display synced memory.
 *
 * Returns an array of snapshots with knowledge, daily, tasks, and mailbox content.
 */
export const getByTaskRun = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskRunId: v.id("taskRuns"),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    // Verify the task run belongs to this team
    const taskRun = await ctx.db.get(args.taskRunId);
    if (!taskRun || taskRun.teamId !== teamId) {
      return [];
    }

    // Query all snapshots for this task run
    const snapshots = await ctx.db
      .query("agentMemorySnapshots")
      .withIndex("by_task_run", (q) => q.eq("taskRunId", args.taskRunId))
      .collect();

    return snapshots;
  },
});
