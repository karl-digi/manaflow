/**
 * Orchestration Background Worker
 *
 * Polls for ready orchestration tasks and auto-spawns agents.
 * This enables autonomous multi-agent orchestration where tasks are
 * automatically processed without manual intervention.
 *
 * ## How It Works
 *
 * 1. Cron job calls pollReadyTasks every minute
 * 2. Worker queries for pending orchestration tasks with resolved dependencies
 * 3. For each ready task, worker calls dispatchSpawn
 * 4. dispatchSpawn gets a task-run JWT from Convex internal mutation
 * 5. dispatchSpawn makes HTTP request to apps/server internal spawn endpoint
 * 6. Server uses JWT-based auth to create tasks/runs via Convex HTTP endpoints
 * 7. Server spawns agent using existing infrastructure
 *
 * ## Authentication Flow
 *
 * The worker bypasses Stack Auth by:
 * 1. Using `taskRuns.getJwtInternal` to get a valid task-run JWT
 * 2. Passing the JWT to the server's internal spawn endpoint
 * 3. Server uses JWT to call Convex HTTP endpoints that validate the JWT internally
 *
 * ## Manual Spawning
 *
 * Users can also manually spawn orchestration tasks via:
 * - CLI: `devsh orchestrate spawn --agent <name> --prompt <prompt>`
 * - CLI with JWT: `devsh orchestrate spawn --use-env-jwt --agent <name> <prompt>`
 * - Web UI: Orchestration panel spawn button
 * - API: POST /api/orchestrate/spawn with Bearer token or X-Task-Run-JWT header
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { isLinkedToProject } from "./orchestrationQueries";

// Configuration
const MAX_CONCURRENT_SPAWNS = 3; // Per-team concurrent spawn limit
const TASK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes - fail tasks running longer than this

/**
 * Poll for ready tasks across all teams.
 * Called by cron job every minute.
 *
 * For each team with pending tasks:
 * 1. Check concurrent spawn limit
 * 2. Get ready tasks with resolved dependencies
 * 3. Dispatch spawns for eligible tasks
 *
 * Also runs timeout checks on running tasks.
 */
export const pollReadyTasks = internalAction({
  args: {},
  handler: async (ctx) => {
    // First, check for timed-out tasks
    await ctx.runMutation(internal.orchestrationWorker.checkForTimedOutTasks, {});

    // Get all unique team IDs with pending tasks
    const teams = await ctx.runQuery(
      internal.orchestrationWorker.getTeamsWithPendingTasks
    );

    for (const teamId of teams) {
      // Check concurrent limit
      const runningCount = await ctx.runQuery(
        internal.orchestrationQueries.countRunningTasks,
        { teamId }
      );

      if (runningCount >= MAX_CONCURRENT_SPAWNS) {
        continue; // Team at capacity
      }

      // Get ready tasks (respecting dependency resolution)
      const readyTasks = await ctx.runQuery(
        internal.orchestrationQueries.getReadyTasksInternal,
        { teamId, limit: MAX_CONCURRENT_SPAWNS - runningCount }
      );

      // Filter out tasks in backoff period
      const now = Date.now();
      const eligibleTasks = readyTasks.filter(
        (t) => !t.nextRetryAfter || t.nextRetryAfter <= now
      );

      // Dispatch spawns (each runs independently)
      for (const task of eligibleTasks) {
        await ctx.scheduler.runAfter(
          0,
          internal.orchestrationWorker.dispatchSpawn,
          {
            taskId: task._id,
            teamId,
          }
        );
      }
    }
  },
});

/**
 * Get unique team IDs with pending tasks.
 */
export const getTeamsWithPendingTasks = internalQuery({
  args: {},
  handler: async (ctx) => {
    const pendingTasks = await ctx.db
      .query("orchestrationTasks")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    return [...new Set(pendingTasks.map((t) => t.teamId))];
  },
});

/**
 * Dispatch a spawn to the apps/server via HTTP.
 */
export const dispatchSpawn = internalAction({
  args: {
    taskId: v.id("orchestrationTasks"),
    teamId: v.string(),
  },
  handler: async (ctx, args) => {
    // Get task details
    const task = await ctx.runQuery(
      internal.orchestrationWorker.getTaskForSpawn,
      { taskId: args.taskId }
    );
    if (!task) return;

    // Claim the task (atomic)
    const claimed = await ctx.runMutation(
      internal.orchestrationQueries.claimTask,
      {
        taskId: args.taskId,
        agentName: task.assignedAgentName ?? "claude/haiku-4.5",
      }
    );
    if (!claimed) return; // Another worker claimed it

    try {
      // Pre-dispatch auth check: fail fast if Codex token is expired
      const agentName = task.assignedAgentName ?? "claude/haiku-4.5";
      if (agentName.toLowerCase().includes("codex")) {
        const tokenStatus = await ctx.runQuery(
          internal.codexTokenRefreshQueries.getTokenStatus,
          { teamId: args.teamId, userId: task.userId }
        );
	        if (tokenStatus === "expired") {
	          throw new Error(
	            "Codex OAuth token has expired. Please run `codex login` locally " +
	              "and update CODEX_AUTH_JSON in settings."
	          );
	        }
	        if (tokenStatus === "missing") {
	          // Check if OPENAI_API_KEY is set as fallback (Codex supports both auth methods)
          const hasOpenAIKey = await ctx.runQuery(
            internal.codexTokenRefreshQueries.hasOpenAIApiKey,
            { teamId: args.teamId, userId: task.userId }
          );
	          if (!hasOpenAIKey) {
	            throw new Error(
	              "No CODEX_AUTH_JSON or OPENAI_API_KEY found. Please run `codex login` locally " +
	                "and set CODEX_AUTH_JSON in settings, or set OPENAI_API_KEY."
	            );
	          }
	          // Has OPENAI_API_KEY fallback, allow orchestration to proceed
	        }
      }

      // Get JWT for the task run (needed for spawn to authenticate)
      if (!task.taskRunId) {
        throw new Error("Task run not created yet");
      }
      const jwtResult = await ctx.runMutation(
        internal.taskRuns.getJwtInternal,
        { taskRunId: task.taskRunId }
      );

      // Call server to spawn
      const serverUrl = process.env.CMUX_SERVER_URL ?? "http://localhost:9779";
      const internalSecret = process.env.CMUX_INTERNAL_SECRET ?? "";

      const response = await fetch(
        `${serverUrl}/api/orchestrate/internal/spawn`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Secret": internalSecret,
          },
          body: JSON.stringify({
            orchestrationTaskId: args.taskId,
            teamId: args.teamId,
            agentName: task.assignedAgentName ?? "claude/haiku-4.5",
            prompt: task.prompt,
            taskId: task.taskId,
            taskRunId: task.taskRunId,
            // Pass JWT and user info for auth context
            taskRunJwt: jwtResult.jwt,
            userId: jwtResult.userId,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Spawn failed: ${response.status} - ${errorText}`);
      }

      // Update task to running status
      await ctx.runMutation(internal.orchestrationQueries.startTaskInternal, {
        taskId: args.taskId,
      });
    } catch (error) {
      // Schedule retry with backoff
      await ctx.runMutation(internal.orchestrationQueries.scheduleRetry, {
        taskId: args.taskId,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
});

/**
 * Get task details for spawning.
 */
export const getTaskForSpawn = internalQuery({
  args: {
    taskId: v.id("orchestrationTasks"),
  },
  handler: async (ctx, args) => {
    return ctx.db.get(args.taskId);
  },
});

/**
 * Handle task completion (called from taskRuns.workerComplete).
 * Updates orchestration task status based on exit code.
 */
export const handleTaskCompletion = internalMutation({
  args: {
    taskRunId: v.id("taskRuns"),
    exitCode: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Find orchestration task by taskRunId
    const orchTask = await ctx.db
      .query("orchestrationTasks")
      .withIndex("by_task_run", (q) => q.eq("taskRunId", args.taskRunId))
      .first();

    if (!orchTask) return; // Not an orchestration-managed task

    const now = Date.now();

    if (args.exitCode === 0 || args.exitCode === undefined) {
      // Success (exitCode 0 or not specified = success)
      await ctx.db.patch(orchTask._id, {
        status: "completed",
        completedAt: now,
        updatedAt: now,
      });
    } else {
      // Failure
      await ctx.db.patch(orchTask._id, {
        status: "failed",
        errorMessage: `Agent exited with code ${args.exitCode}`,
        completedAt: now,
        updatedAt: now,
      });

      // Cascade failure to dependent tasks
      await ctx.scheduler.runAfter(0, internal.orchestrationQueries.cascadeFailureToDependent, {
        failedTaskId: orchTask._id,
      });
    }

    // Trigger dependent tasks immediately (don't wait for poll cycle)
    await ctx.scheduler.runAfter(0, internal.orchestrationQueries.triggerDependentTasks, {
      completedTaskId: orchTask._id,
    });

    // Sync project status if linked
    if (isLinkedToProject(orchTask)) {
      await ctx.scheduler.runAfter(0, internal.projectQueries.syncPlanStatusFromOrchestration, {
        orchestrationTaskId: orchTask._id,
      });
    }
  },
});

/**
 * Check for and timeout stale running tasks.
 * Called by the background worker to fail tasks that have been running too long.
 */
export const checkForTimedOutTasks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const timeoutThreshold = now - TASK_TIMEOUT_MS;

    // Find running tasks that started before the timeout threshold
    const runningTasks = await ctx.db
      .query("orchestrationTasks")
      .withIndex("by_status_started", (q) =>
        q.eq("status", "running").lt("startedAt", timeoutThreshold)
      )
      .collect();

    for (const task of runningTasks) {
      if (task.startedAt && task.startedAt < timeoutThreshold) {
        await ctx.db.patch(task._id, {
          status: "failed",
          errorMessage: `Task timed out after ${TASK_TIMEOUT_MS / 60000} minutes`,
          completedAt: now,
          updatedAt: now,
        });

        // Cascade failure to dependent tasks
        await ctx.scheduler.runAfter(0, internal.orchestrationQueries.cascadeFailureToDependent, {
          failedTaskId: task._id,
        });
      }
    }
  },
});

const ORPHAN_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ORPHAN_BATCH_SIZE = 100;

/**
 * Clean up orphan tasks that have been pending for 7+ days with no activity.
 * Called by daily cron to prevent tasks from being stuck forever.
 */
export const cleanupOrphanTasks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const orphanThreshold = now - ORPHAN_THRESHOLD_MS;

    const pendingTasks = await ctx.db
      .query("orchestrationTasks")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(ORPHAN_BATCH_SIZE * 10); // Over-fetch to filter

    let cancelled = 0;
    for (const task of pendingTasks) {
      if (cancelled >= ORPHAN_BATCH_SIZE) break;
      if (task.updatedAt < orphanThreshold) {
        await ctx.db.patch(task._id, {
          status: "cancelled",
          errorMessage: "Cancelled: pending for 7+ days with no activity",
          completedAt: now,
          updatedAt: now,
        });

        // Cascade failure to dependent tasks
        await ctx.scheduler.runAfter(0, internal.orchestrationQueries.cascadeFailureToDependent, {
          failedTaskId: task._id,
        });

        cancelled++;
      }
    }

    if (cancelled > 0) {
      console.log(`[orchestrationWorker] Cleaned up ${cancelled} orphan tasks`);
    }
  },
});
