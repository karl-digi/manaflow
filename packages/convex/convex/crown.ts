import { v } from "convex/values";
import { getTeamId } from "../_shared/team";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { authMutation, authQuery, taskIdWithFake } from "./users/utils";
import {
  detectEmptyDiffs,
  parseCrownEvaluationPrompt,
} from "./crown/retryData";

const CROWN_RETRY_COOLDOWN_MS = 30_000;

export const evaluateAndCrownWinner = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    try {
      console.log(`[Crown] ============================================`);
      console.log(`[Crown] EVALUATE AND CROWN WINNER CALLED`);
      console.log(`[Crown] Task ID: ${args.taskId}`);
      console.log(`[Crown] ============================================`);

      const userId = ctx.identity.subject;
      const task = await ctx.db.get(args.taskId);
      if (!task) {
        console.error(`[Crown] Task ${args.taskId} not found`);
        throw new Error("Task not found");
      }
      const teamId = await getTeamId(ctx, args.teamSlugOrId);
      if (task.teamId !== teamId || task.userId !== userId) {
        throw new Error("Unauthorized");
      }

      // Get all completed runs for this task
      const taskRuns = await ctx.db
        .query("taskRuns")
        .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
        .filter((q) => q.eq(q.field("teamId"), teamId))
        .filter((q) => q.eq(q.field("userId"), userId))
        .filter((q) => q.eq(q.field("status"), "completed"))
        .collect();

      console.log(
        `[Crown] Found ${taskRuns.length} completed runs for task ${args.taskId}`
      );

      // If only one model or less, crown it by default
      if (taskRuns.length <= 1) {
        if (taskRuns.length === 1) {
          await ctx.db.patch(taskRuns[0]._id, {
            isCrowned: true,
            crownReason: "Only one model completed the task",
          });
          // Update selectedTaskRunId on the task
          await ctx.db.patch(args.taskId, { selectedTaskRunId: taskRuns[0]._id });
        }
        return taskRuns[0]?._id || null;
      }

      // Only evaluate if 2+ models completed
      if (taskRuns.length < 2) {
        return null;
      }

      // Check if evaluation already exists or is pending
      const existingEvaluation = await ctx.db
        .query("crownEvaluations")
        .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
        .filter((q) => q.eq(q.field("teamId"), teamId))
        .filter((q) => q.eq(q.field("userId"), userId))
        .first();

      if (existingEvaluation) {
        console.log(
          `[Crown] Evaluation already exists for task ${args.taskId}, returning winner`
        );
        return existingEvaluation.winnerRunId;
      }

      // Check if already marked for evaluation
      if (
        task.crownEvaluationStatus === "pending" ||
        task.crownEvaluationStatus === "in_progress"
      ) {
        console.log(
          `[Crown] Task ${args.taskId} already marked for evaluation (${task.crownEvaluationStatus})`
        );
        return "pending";
      }

      // Mark that crown evaluation is needed
      // The server will handle the actual evaluation using Claude Code
      await ctx.db.patch(args.taskId, {
        crownEvaluationStatus: "pending",
        crownEvaluationError: undefined,
        updatedAt: Date.now(),
      });

      console.log(`[Crown] Marked task ${args.taskId} for crown evaluation`);
      return "pending";
    } catch (error) {
      console.error(
        `[Crown] Crown evaluation failed for task ${args.taskId}:`,
        error
      );
      throw error;
    }
  },
});

export const setCrownWinner = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskRunId: v.id("taskRuns"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    console.log(`[Crown] ============================================`);
    console.log(`[Crown] SET CROWN WINNER CALLED`);
    console.log(`[Crown] Task Run ID: ${args.taskRunId}`);
    console.log(`[Crown] Reason: ${args.reason}`);
    console.log(`[Crown] ============================================`);

    const userId = ctx.identity.subject;
    const taskRun = await ctx.db.get(args.taskRunId);
    if (!taskRun) {
      throw new Error("Task run not found");
    }
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    if (taskRun.teamId !== teamId || taskRun.userId !== userId) {
      throw new Error("Unauthorized");
    }

    // Get all runs for this task
    const taskRuns = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", taskRun.taskId))
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    // Update the selected run as crowned
    await ctx.db.patch(args.taskRunId, {
      isCrowned: true,
      crownReason: args.reason,
    });

    // Update other runs to ensure they're not crowned
    for (const run of taskRuns) {
      if (run._id !== args.taskRunId) {
        await ctx.db.patch(run._id, {
          isCrowned: false,
        });
      }
    }

    // Clear crown evaluation error and update selectedTaskRunId
    await ctx.db.patch(taskRun.taskId, {
      crownEvaluationStatus: "succeeded",
      crownEvaluationError: undefined,
      selectedTaskRunId: args.taskRunId,
      updatedAt: Date.now(),
    });

    // Create evaluation record
    await ctx.db.insert("crownEvaluations", {
      taskId: taskRun.taskId,
      evaluatedAt: Date.now(),
      winnerRunId: args.taskRunId,
      candidateRunIds: taskRuns.map((r) => r._id),
      evaluationPrompt: "Evaluated by Claude Code",
      evaluationResponse: args.reason,
      createdAt: Date.now(),
      userId,
      teamId,
    });

    // Mark PR creation needed and clear any existing PR associations
    await ctx.db.patch(args.taskRunId, {
      pullRequestUrl: "pending",
      pullRequests: undefined,
    });

    // Clear junction table entries for this taskRun
    const existingJunctionEntries = await ctx.db
      .query("taskRunPullRequests")
      .withIndex("by_task_run", (q) => q.eq("taskRunId", args.taskRunId))
      .collect();
    for (const entry of existingJunctionEntries) {
      await ctx.db.delete(entry._id);
    }

    return args.taskRunId;
  },
});

export const getCrownedRun = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const crownedRun = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .filter((q) => q.eq(q.field("isCrowned"), true))
      .first();

    console.log(
      `[Crown] getCrownedRun for task ${args.taskId}: ${crownedRun ? `found ${crownedRun._id}` : "not found"}`
    );

    return crownedRun;
  },
});

export const getCrownEvaluation = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskId: taskIdWithFake,
  },
  handler: async (ctx, args) => {
    // Handle fake IDs by returning null
    if (typeof args.taskId === 'string' && args.taskId.startsWith('fake-')) {
      return null;
    }

    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const evaluation = await ctx.db
      .query("crownEvaluations")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId as Id<"tasks">))
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .first();

    return evaluation;
  },
});

export const getTasksWithCrowns = authQuery({
  args: {
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    
    // Get all crowned runs for this team/user
    const crownedRuns = await ctx.db
      .query("taskRuns")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("isCrowned"), true))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    // Extract unique task IDs
    const taskIds = new Set<Id<"tasks">>();
    for (const run of crownedRuns) {
      taskIds.add(run.taskId);
    }

    return Array.from(taskIds);
  },
});

/**
 * Retry crown evaluation after a previous failure.
 * Validates the task has retry data and schedules the retry action.
 */
export const retryCrownEvaluation = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    if (task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Unauthorized");
    }

    // Only allow retry if status is "error"
    if (task.crownEvaluationStatus !== "error") {
      console.log(
        `[Crown] Retry not allowed: status is ${task.crownEvaluationStatus}`
      );
      throw new Error(
        `Cannot retry: evaluation status is "${task.crownEvaluationStatus}", expected "error"`
      );
    }

    const now = Date.now();
    const lastRetryAt = task.crownEvaluationLastRetryAt ?? 0;
    if (now - lastRetryAt < CROWN_RETRY_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil(
        (CROWN_RETRY_COOLDOWN_MS - (now - lastRetryAt)) / 1000,
      );
      throw new Error(
        `Please wait ${remainingSeconds}s before retrying the crown evaluation.`,
      );
    }

    const nextRetryCount = (task.crownEvaluationRetryCount ?? 0) + 1;

    // Check if we have retry data
    if (!task.crownEvaluationRetryData) {
      console.log(
        `[Crown] No stored retry data for task ${args.taskId}, checking for running sandboxes`
      );

      // Get completed task runs to check sandbox status
      const taskRuns = await ctx.db
        .query("taskRuns")
        .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
        .filter((q) => q.eq(q.field("teamId"), teamId))
        .filter((q) => q.eq(q.field("userId"), userId))
        .filter((q) => q.eq(q.field("status"), "completed"))
        .collect();

      if (taskRuns.length === 0) {
        throw new Error(
          "Cannot retry: No completed task runs found for this task."
        );
      }

      // Check if any sandbox is still running
      const hasRunningSandbox = taskRuns.some(
        (run) => run.vscode?.status === "running"
      );

      if (!hasRunningSandbox) {
        throw new Error(
          "Cannot retry: No sandbox available to collect diffs. " +
            "The sandboxes have been stopped. Please create a new task."
        );
      }

      // Reset to pending and schedule fresh evaluation
      await ctx.db.patch(args.taskId, {
        crownEvaluationStatus: "pending",
        crownEvaluationError: undefined,
        crownEvaluationRetryCount: nextRetryCount,
        crownEvaluationLastRetryAt: now,
        crownEvaluationIsRefreshing: false,
        updatedAt: now,
      });

      // Schedule fresh evaluation that will collect diffs from running sandbox
      await ctx.scheduler.runAfter(
        0,
        internal.crown.actions.retryEvaluationFresh,
        {
          taskId: args.taskId,
          teamId,
          userId,
          taskRunIds: taskRuns.map((r) => r._id),
        }
      );

      console.log(
        `[Crown] Scheduled fresh retry evaluation for task ${args.taskId}`
      );
      return "pending";
    }

    // Reset to pending for re-evaluation (has stored retry data)
    await ctx.db.patch(args.taskId, {
      crownEvaluationStatus: "pending",
      crownEvaluationError: undefined,
      crownEvaluationRetryCount: nextRetryCount,
      crownEvaluationLastRetryAt: now,
      crownEvaluationIsRefreshing: false,
      updatedAt: now,
    });

    // Schedule the retry action with stored data
    await ctx.scheduler.runAfter(0, internal.crown.actions.retryEvaluation, {
      taskId: args.taskId,
    });

    console.log(`[Crown] Scheduled retry evaluation for task ${args.taskId}`);
    return "pending";
  },
});

/**
 * Refresh a succeeded crown evaluation that had empty diffs.
 * Similar to retry, but works on succeeded evaluations to fetch fresh diffs from GitHub.
 * Non-destructive: existing evaluation is preserved until new diffs are successfully fetched.
 */
export const refreshCrownEvaluation = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    if (task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Unauthorized");
    }

    // Allow refresh when status is "succeeded"
    if (task.crownEvaluationStatus !== "succeeded") {
      throw new Error(
        `Cannot refresh: evaluation status is "${task.crownEvaluationStatus}", expected "succeeded"`
      );
    }

    // Check cooldown
    const now = Date.now();
    const lastRetryAt = task.crownEvaluationLastRetryAt ?? 0;
    if (now - lastRetryAt < CROWN_RETRY_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil(
        (CROWN_RETRY_COOLDOWN_MS - (now - lastRetryAt)) / 1000
      );
      throw new Error(
        `Please wait ${remainingSeconds}s before refreshing the crown evaluation.`
      );
    }

    // Get the existing evaluation
    const existingEvaluation = await ctx.db
      .query("crownEvaluations")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .filter(
        (q) =>
          q.eq(q.field("teamId"), teamId) && q.eq(q.field("userId"), userId)
      )
      .first();

    if (!existingEvaluation) {
      throw new Error("No evaluation found to refresh");
    }

    // Get completed task runs
    const taskRuns = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .filter((q) => q.eq(q.field("status"), "completed"))
      .collect();

    if (taskRuns.length === 0) {
      throw new Error(
        "Cannot refresh: No completed task runs found for this task."
      );
    }

    // NON-DESTRUCTIVE: Don't delete evaluation or uncrown winner here.
    // The action will do this only after successfully fetching fresh diffs.
    // This preserves the prior result if GitHub fetch fails.

    // Mark task as refreshing (keep status "succeeded" until action starts)
    const nextRetryCount = (task.crownEvaluationRetryCount ?? 0) + 1;
    await ctx.db.patch(args.taskId, {
      crownEvaluationIsRefreshing: true,
      crownEvaluationRetryCount: nextRetryCount,
      crownEvaluationLastRetryAt: now,
      updatedAt: now,
    });

    // Schedule fresh evaluation to fetch new diffs from GitHub
    // Pass existing evaluation/winner IDs so action can clean them up on success
    await ctx.scheduler.runAfter(
      0,
      internal.crown.actions.retryEvaluationFresh,
      {
        taskId: args.taskId,
        teamId,
        userId,
        taskRunIds: taskRuns.map((r) => r._id),
        isRefresh: true,
        existingEvaluationId: existingEvaluation._id,
        existingWinnerRunId: existingEvaluation.winnerRunId,
      }
    );

    console.log(
      `[Crown] Scheduled refresh evaluation for task ${args.taskId}`
    );
    return "pending";
  },
});

/**
 * Clean up old evaluation and uncrown winner before creating new evaluation.
 * Called by retryEvaluationFresh after successfully fetching fresh diffs.
 * Part of non-destructive refresh pattern.
 */
export const cleanupOldEvaluation = internalMutation({
  args: {
    existingEvaluationId: v.id("crownEvaluations"),
    existingWinnerRunId: v.optional(v.id("taskRuns")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Uncrown the old winner
    if (args.existingWinnerRunId) {
      const winnerRun = await ctx.db.get(args.existingWinnerRunId);
      if (winnerRun) {
        await ctx.db.patch(args.existingWinnerRunId, {
          isCrowned: false,
          crownReason: undefined,
          summary: undefined,
          updatedAt: now,
        });
      }
    }

    // Delete the old evaluation
    const existingEval = await ctx.db.get(args.existingEvaluationId);
    if (existingEval) {
      await ctx.db.delete(args.existingEvaluationId);
    }

    console.log(
      `[Crown] Cleaned up old evaluation ${args.existingEvaluationId}`
    );
  },
});

/**
 * Restore task to succeeded state after failed refresh (non-destructive pattern).
 * Called when GitHub diff fetch fails but old evaluation still exists.
 */
export const restoreAfterFailedRefresh = internalMutation({
  args: {
    taskId: v.id("tasks"),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.taskId, {
      crownEvaluationStatus: "succeeded",
      crownEvaluationIsRefreshing: false,
      crownEvaluationError: args.errorMessage,
      updatedAt: now,
    });
    console.log(
      `[Crown] Restored task ${args.taskId} to succeeded after failed refresh`
    );
  },
});

export const getEvaluationByTaskInternal = internalQuery({
  args: {
    taskId: v.id("tasks"),
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const evaluations = await ctx.db
      .query("crownEvaluations")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", args.userId)
      )
      .collect();

    return (
      evaluations.find((evaluation) => evaluation.taskId === args.taskId) ?? null
    );
  },
});

export const workerFinalize = internalMutation({
  args: {
    taskId: v.id("tasks"),
    teamId: v.string(),
    userId: v.string(),
    winnerRunId: v.optional(v.union(v.id("taskRuns"), v.null())),
    reason: v.string(),
    summary: v.optional(v.string()),
    evaluationPrompt: v.string(),
    evaluationResponse: v.string(),
    candidateRunIds: v.array(v.id("taskRuns")),
    pullRequest: v.optional(
      v.object({
        url: v.string(),
        isDraft: v.optional(v.boolean()),
        state: v.optional(
          v.union(
            v.literal("none"),
            v.literal("draft"),
            v.literal("open"),
            v.literal("merged"),
            v.literal("closed"),
            v.literal("unknown")
          )
        ),
        number: v.optional(v.number()),
      })
    ),
    pullRequestTitle: v.optional(v.string()),
    pullRequestDescription: v.optional(v.string()),
    /** Whether this evaluation was produced by fallback due to AI service failure */
    isFallback: v.optional(v.boolean()),
    /** Human-readable note about the evaluation process */
    evaluationNote: v.optional(v.string()),
    /** Auto-refresh count to persist across re-evaluations */
    autoRefreshCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.teamId !== args.teamId || task.userId !== args.userId) {
      throw new Error("Task not found or unauthorized");
    }

    const existingEvaluation = await ctx.db
      .query("crownEvaluations")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .filter(
        (q) =>
          q.eq(q.field("teamId"), args.teamId) &&
          q.eq(q.field("userId"), args.userId),
      )
      .first();

    if (existingEvaluation) {
      throw new Error("Crown evaluation already exists for this task");
    }

    const now = Date.now();

    // Determine if this is a crown competition (multiple candidates)
    // Single-run scenarios (1 candidate) should NOT have [Crown] prefix
    const isCrownCompetition = args.candidateRunIds.length > 1;

    // Compute the correct PR title based on candidate count
    // This ensures consistent behavior regardless of worker-provided title format
    const computePullRequestTitle = (prompt: string): string => {
      const base = prompt.trim() || "cmux changes";
      const title = isCrownCompetition ? `[Crown] ${base}` : base;
      return title.length > 72 ? `${title.slice(0, 69)}...` : title;
    };

    // Compute the final PR title, overriding worker-provided title if format is wrong
    let finalPullRequestTitle = args.pullRequestTitle;
    if (args.pullRequestTitle) {
      const hasWrongPrefix = !isCrownCompetition && args.pullRequestTitle.startsWith("[Crown] ");
      const missingPrefix = isCrownCompetition && !args.pullRequestTitle.startsWith("[Crown] ");
      if (hasWrongPrefix || missingPrefix) {
        // Re-derive from task text (the task prompt)
        finalPullRequestTitle = computePullRequestTitle(task.text || "cmux changes");
      }
    }

    const summaryMissing = !args.summary || args.summary.trim().length === 0;

    // If no winner was selected, or summarization failed, mark task as error and store retry data
    if (!args.winnerRunId || summaryMissing) {
      const currentRetryCount = task.crownEvaluationRetryCount ?? 0;
      const retryData = {
        evaluationPrompt: args.evaluationPrompt,
        candidateRunIds: args.candidateRunIds,
        teamId: args.teamId,
        userId: args.userId,
      };

      const hasParseablePrompt = Boolean(
        parseCrownEvaluationPrompt(args.evaluationPrompt)
      );
      const retryDataJson = JSON.stringify(retryData);
      const retryDataToStore =
        !hasParseablePrompt && task.crownEvaluationRetryData
          ? task.crownEvaluationRetryData
          : retryDataJson;

      const errorMessage = summaryMissing
        ? args.evaluationNote ||
          "Crown summarization failed (missing summary); retry to rerun evaluation and summarization."
        : args.evaluationNote || args.reason;

      await ctx.db.patch(args.taskId, {
        crownEvaluationStatus: "error",
        crownEvaluationError: errorMessage,
        crownEvaluationRetryData: retryDataToStore,
        crownEvaluationRetryCount: currentRetryCount,
        crownEvaluationLastRetryAt: task.crownEvaluationLastRetryAt,
        crownEvaluationIsRefreshing: undefined,
        isCompleted: true, // Mark completed to unblock the task flow
        updatedAt: now,
      });

      console.log(`[Crown] Stored retry data for task ${args.taskId}`);
      return null;
    }

    // Parse candidates from evaluation prompt to detect empty diffs
    const parsed = parseCrownEvaluationPrompt(args.evaluationPrompt);
    const hadEmptyDiffs = parsed ? detectEmptyDiffs(parsed.candidates) : false;

    // Proceed with normal winner crowning
    await ctx.db.insert("crownEvaluations", {
      taskId: args.taskId,
      evaluatedAt: now,
      winnerRunId: args.winnerRunId,
      candidateRunIds: args.candidateRunIds,
      evaluationPrompt: args.evaluationPrompt,
      evaluationResponse: args.evaluationResponse,
      createdAt: now,
      userId: args.userId,
      teamId: args.teamId,
      ...(args.isFallback !== undefined ? { isFallback: args.isFallback } : {}),
      ...(args.evaluationNote ? { evaluationNote: args.evaluationNote } : {}),
      ...(hadEmptyDiffs ? { hadEmptyDiffs } : {}),
      ...(args.autoRefreshCount !== undefined ? { autoRefreshCount: args.autoRefreshCount } : {}),
    });

    const runsForTeam = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .filter(
        (q) =>
          q.eq(q.field("teamId"), args.teamId) &&
          q.eq(q.field("userId"), args.userId),
      )
      .collect();

    const winnerRun = runsForTeam.find((run) => run._id === args.winnerRunId);
    if (!winnerRun) {
      throw new Error("Winner run not found");
    }

    await ctx.db.patch(args.winnerRunId, {
      isCrowned: true,
      crownReason: args.reason,
      summary: args.summary,
      ...(args.pullRequest?.url ? { pullRequestUrl: args.pullRequest.url } : {}),
      ...(args.pullRequest?.isDraft !== undefined
        ? { pullRequestIsDraft: args.pullRequest.isDraft }
        : {}),
      ...(args.pullRequest?.state
        ? { pullRequestState: args.pullRequest.state }
        : {}),
      ...(args.pullRequest?.number !== undefined
        ? { pullRequestNumber: args.pullRequest.number }
        : {}),
      updatedAt: now,
    });

    for (const run of runsForTeam) {
      if (run._id === args.winnerRunId) continue;
      await ctx.db.patch(run._id, {
        isCrowned: false,
        updatedAt: now,
      });
    }

    await ctx.db.patch(args.taskId, {
      crownEvaluationStatus: "succeeded",
      crownEvaluationError: undefined,
      isCompleted: true,
      updatedAt: now,
      crownEvaluationRetryData: undefined,
      crownEvaluationRetryCount: undefined,
      crownEvaluationLastRetryAt: undefined,
      crownEvaluationIsRefreshing: undefined,
      ...(finalPullRequestTitle ? { pullRequestTitle: finalPullRequestTitle } : {}),
      ...(args.pullRequestDescription
        ? { pullRequestDescription: args.pullRequestDescription }
        : {}),
    });

    return args.winnerRunId;
  },
});

/**
 * Recover crown evaluations that are stuck in pending/in_progress state.
 * This can happen when the worker process crashes or terminates before
 * completing the crown evaluation flow.
 *
 * Runs every 5 minutes via cron job.
 */
export const recoverStuckEvaluations = internalMutation({
  handler: async (ctx) => {
    const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
    const cutoffTime = Date.now() - STUCK_THRESHOLD_MS;

    // Find tasks stuck in pending/in_progress for >5 minutes
    // Use index to avoid full table scan
    const pendingTasks = await ctx.db
      .query("tasks")
      .withIndex("by_crown_status", (q) =>
        q.eq("crownEvaluationStatus", "pending")
      )
      .collect();

    const inProgressTasks = await ctx.db
      .query("tasks")
      .withIndex("by_crown_status", (q) =>
        q.eq("crownEvaluationStatus", "in_progress")
      )
      .collect();

    // Filter by cutoff time, using createdAt as fallback for tasks without updatedAt
    const stuckTasks = [...pendingTasks, ...inProgressTasks].filter(
      (task) => (task.updatedAt ?? task.createdAt ?? 0) < cutoffTime
    );

    if (stuckTasks.length === 0) {
      return { recovered: 0 };
    }

    console.log(
      `[crown] Found ${stuckTasks.length} stuck crown evaluations to recover`
    );

    let recoveredCount = 0;

    for (const task of stuckTasks) {
      // Check if there's already an evaluation for this task
      const existingEvaluation = await ctx.db
        .query("crownEvaluations")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .filter((q) =>
          q.and(
            q.eq(q.field("teamId"), task.teamId),
            q.eq(q.field("userId"), task.userId)
          )
        )
        .first();

      if (existingEvaluation) {
        // Evaluation exists but status not updated - fix the status
        console.log(
          `[crown] Task ${task._id} has evaluation but wrong status, fixing to succeeded`
        );
        await ctx.db.patch(task._id, {
          crownEvaluationStatus: "succeeded",
          crownEvaluationError: undefined,
          updatedAt: Date.now(),
        });
        recoveredCount++;
        continue;
      }

      // No evaluation exists - mark as error so user can retry
      const stuckDuration = Math.round(
        (Date.now() - (task.updatedAt ?? task.createdAt ?? Date.now())) / 1000 / 60
      );
      console.log(
        `[crown] Recovering stuck evaluation for task ${task._id} (stuck for ${stuckDuration} minutes)`
      );

      await ctx.db.patch(task._id, {
        crownEvaluationStatus: "error",
        crownEvaluationError: `Crown evaluation timed out after ${stuckDuration} minutes. This may have been caused by a worker crash or network issue. Click "Retry" to try again.`,
        updatedAt: Date.now(),
      });
      recoveredCount++;
    }

    console.log(`[crown] Recovered ${recoveredCount} stuck crown evaluations`);
    return { recovered: recoveredCount };
  },
});

const MAX_AUTO_REFRESH_COUNT = 2;
const AUTO_REFRESH_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Auto-refresh crown evaluations that succeeded with empty diffs.
 * Runs every 5 minutes via cron job to detect and re-evaluate when fresh diffs may be available.
 */
export const autoRefreshEmptyDiffEvaluations = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const cutoffTime = now - AUTO_REFRESH_LOOKBACK_MS;

    // Find evaluations with empty diffs in the last 24 hours
    const emptyDiffEvaluations = await ctx.db
      .query("crownEvaluations")
      .withIndex("by_empty_diffs", (q) =>
        q.eq("hadEmptyDiffs", true).gt("evaluatedAt", cutoffTime)
      )
      .collect();

    if (emptyDiffEvaluations.length === 0) {
      return { refreshed: 0, skipped: 0 };
    }

    console.log(
      `[crown] Found ${emptyDiffEvaluations.length} evaluations with empty diffs to check`
    );

    let refreshedCount = 0;
    let skippedCount = 0;

    for (const evaluation of emptyDiffEvaluations) {
      // Skip if already hit max auto-refresh count
      const currentAutoRefreshCount = evaluation.autoRefreshCount ?? 0;
      if (currentAutoRefreshCount >= MAX_AUTO_REFRESH_COUNT) {
        skippedCount++;
        continue;
      }

      // Get the task to verify it can be refreshed
      const task = await ctx.db.get(evaluation.taskId);
      if (!task) {
        console.log(
          `[crown] Skipping evaluation ${evaluation._id}: task not found`
        );
        skippedCount++;
        continue;
      }

      // Skip if task is not in succeeded state
      if (task.crownEvaluationStatus !== "succeeded") {
        skippedCount++;
        continue;
      }

      // Get completed task runs
      const taskRuns = await ctx.db
        .query("taskRuns")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .filter((q) => q.eq(q.field("teamId"), task.teamId))
        .filter((q) => q.eq(q.field("userId"), task.userId))
        .filter((q) => q.eq(q.field("status"), "completed"))
        .collect();

      if (taskRuns.length === 0) {
        skippedCount++;
        continue;
      }

      // Check if we can potentially get fresh diffs (need newBranch info)
      const hasRefreshableBranches = taskRuns.some(
        (run) => run.newBranch && task.projectFullName && task.baseBranch
      );

      if (!hasRefreshableBranches) {
        console.log(
          `[crown] Skipping evaluation ${evaluation._id}: no refreshable branches`
        );
        skippedCount++;
        continue;
      }

      console.log(
        `[crown] Auto-refreshing evaluation for task ${task._id} (attempt ${currentAutoRefreshCount + 1})`
      );

      // NON-DESTRUCTIVE: Don't delete evaluation or uncrown winner here.
      // The action will do this only after successfully fetching fresh diffs.
      const newAutoRefreshCount = currentAutoRefreshCount + 1;

      // Mark task as refreshing (keep status "succeeded" until action starts)
      await ctx.db.patch(task._id, {
        crownEvaluationIsRefreshing: true,
        updatedAt: now,
      });

      // Schedule fresh evaluation to fetch new diffs from GitHub
      // Pass existing evaluation/winner IDs so action can clean them up on success
      await ctx.scheduler.runAfter(
        0,
        internal.crown.actions.retryEvaluationFresh,
        {
          taskId: task._id,
          teamId: task.teamId,
          userId: task.userId,
          taskRunIds: taskRuns.map((r) => r._id),
          isRefresh: true,
          autoRefreshCount: newAutoRefreshCount,
          existingEvaluationId: evaluation._id,
          existingWinnerRunId: evaluation.winnerRunId,
        }
      );

      refreshedCount++;
    }

    console.log(
      `[crown] Auto-refresh complete: ${refreshedCount} refreshed, ${skippedCount} skipped`
    );
    return { refreshed: refreshedCount, skipped: skippedCount };
  },
});

const MISSING_EVAL_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours
const MISSING_EVAL_MIN_AGE_MS = 15 * 60 * 1000; // 15 minutes after completion

/**
 * Recover tasks where all runs completed but no crown evaluation was created.
 * This can happen when:
 * - Worker completion flow was interrupted
 * - Sandbox was stopped before crown workflow ran
 * - Network issues prevented crown API calls
 *
 * Finds completed tasks without evaluations and attempts to fetch diffs from GitHub.
 * Runs every hour via cron job.
 */
export const recoverMissingEvaluations = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const cutoffTime = now - MISSING_EVAL_LOOKBACK_MS;
    const minAgeTime = now - MISSING_EVAL_MIN_AGE_MS;

    // Find tasks that:
    // 1. Are completed (isCompleted = true)
    // 2. Have no crown evaluation status OR status is "error"
    // 3. Were created in the last 24 hours (don't process very old tasks)
    // 4. Have projectFullName and baseBranch (can fetch diffs from GitHub)
    // 5. Are old enough (completed >15 min ago) to avoid racing with worker
    const candidateTasks = await ctx.db
      .query("tasks")
      .withIndex("by_created", (q) => q.gt("createdAt", cutoffTime))
      .filter((q) =>
        q.and(
          q.eq(q.field("isCompleted"), true),
          // Only process tasks that are old enough (completed >15 min ago)
          q.lt(q.field("lastActivityAt"), minAgeTime),
          // Must have GitHub info to fetch diffs
          q.neq(q.field("projectFullName"), undefined),
          q.neq(q.field("baseBranch"), undefined)
        )
      )
      .collect();

    // Filter to tasks without crown evaluation or in error state
    const tasksToProcess = candidateTasks.filter(
      (task) =>
        !task.crownEvaluationStatus ||
        task.crownEvaluationStatus === "error"
    );

    if (tasksToProcess.length === 0) {
      return { processed: 0, skipped: 0 };
    }

    console.log(
      `[crown] Found ${tasksToProcess.length} tasks potentially missing crown evaluation`
    );

    let processedCount = 0;
    let skippedCount = 0;

    for (const task of tasksToProcess) {
      // Check if there's already an evaluation
      const existingEvaluation = await ctx.db
        .query("crownEvaluations")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .filter((q) =>
          q.and(
            q.eq(q.field("teamId"), task.teamId),
            q.eq(q.field("userId"), task.userId)
          )
        )
        .first();

      if (existingEvaluation) {
        // Has evaluation but status not updated - fix status
        if (task.crownEvaluationStatus !== "succeeded") {
          await ctx.db.patch(task._id, {
            crownEvaluationStatus: "succeeded",
            crownEvaluationError: undefined,
            updatedAt: now,
          });
          console.log(
            `[crown] Fixed status for task ${task._id} - evaluation exists`
          );
        }
        skippedCount++;
        continue;
      }

      // Get completed task runs
      const taskRuns = await ctx.db
        .query("taskRuns")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .filter((q) => q.eq(q.field("teamId"), task.teamId))
        .filter((q) => q.eq(q.field("userId"), task.userId))
        .filter((q) => q.eq(q.field("status"), "completed"))
        .collect();

      if (taskRuns.length === 0) {
        skippedCount++;
        continue;
      }

      // Check if all runs have branch info for GitHub diff fetching
      const runsWithBranches = taskRuns.filter(
        (run) => run.newBranch
      );

      if (runsWithBranches.length === 0) {
        console.log(
          `[crown] Skipping task ${task._id}: no runs with branch info`
        );
        skippedCount++;
        continue;
      }

      // Only auto-recover if we have 2+ completed runs (multi-agent comparison)
      // Single-run tasks should have been auto-crowned by the worker
      if (taskRuns.length === 1) {
        // Single run - try to auto-crown it
        const singleRun = taskRuns[0];
        if (!singleRun.isCrowned && singleRun.newBranch) {
          console.log(
            `[crown] Auto-crowning single run ${singleRun._id} for task ${task._id}`
          );
          await ctx.db.patch(singleRun._id, {
            isCrowned: true,
            crownReason: "Auto-crowned: Single completed run (recovery)",
          });
          await ctx.db.patch(task._id, {
            selectedTaskRunId: singleRun._id,
            crownEvaluationStatus: "succeeded",
            crownEvaluationError: undefined,
            updatedAt: now,
          });
          processedCount++;
          continue;
        }
        skippedCount++;
        continue;
      }

      console.log(
        `[crown] Scheduling GitHub diff fetch for task ${task._id} (${taskRuns.length} runs)`
      );

      // Mark as pending to prevent duplicate processing
      await ctx.db.patch(task._id, {
        crownEvaluationStatus: "pending",
        crownEvaluationError: undefined,
        updatedAt: now,
      });

      // Schedule fresh evaluation to fetch diffs from GitHub
      await ctx.scheduler.runAfter(
        0,
        internal.crown.actions.retryEvaluationFresh,
        {
          taskId: task._id,
          teamId: task.teamId,
          userId: task.userId,
          taskRunIds: runsWithBranches.map((r) => r._id),
          isRefresh: true, // Use GitHub API instead of sandbox
        }
      );

      processedCount++;
    }

    console.log(
      `[crown] Missing evaluation recovery: ${processedCount} processed, ${skippedCount} skipped`
    );
    return { processed: processedCount, skipped: skippedCount };
  },
});

/**
 * TEST ONLY: Clear retry data for a task to test the fresh retry flow.
 * Use internalMutation so it can be called from Convex dashboard.
 */
export const _testClearRetryData = internalMutation({
  args: {
    taskId: v.id("tasks"),
    resetStatus: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    console.log(`[Crown TEST] Clearing retry data for task ${args.taskId}`);

    const updates: Record<string, unknown> = {
      crownEvaluationRetryData: undefined,
      updatedAt: Date.now(),
    };

    // Also reset status to error if requested
    if (args.resetStatus) {
      updates.crownEvaluationStatus = "error";
      updates.crownEvaluationError = "Test reset for retry";

      // Also delete any existing crown evaluation record
      const existingEval = await ctx.db
        .query("crownEvaluations")
        .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
        .first();
      if (existingEval) {
        console.log(`[Crown TEST] Deleting crown evaluation ${existingEval._id}`);
        await ctx.db.delete(existingEval._id);
      }

      // Also uncrown any runs
      const taskRuns = await ctx.db
        .query("taskRuns")
        .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
        .collect();
      for (const run of taskRuns) {
        if (run.isCrowned) {
          console.log(`[Crown TEST] Uncrowning run ${run._id}`);
          await ctx.db.patch(run._id, {
            isCrowned: false,
            crownReason: undefined,
            summary: undefined,
          });
        }
      }
    }

    await ctx.db.patch(args.taskId, updates);

    return { success: true };
  },
});
