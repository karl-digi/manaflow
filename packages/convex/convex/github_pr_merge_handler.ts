import { v } from "convex/values";
import type { PullRequestEvent } from "@octokit/webhooks-types";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

/**
 * Find taskRuns that have the given PR URL(s) associated with them.
 * Handles both single PR (legacy) and multiple PRs (new format).
 */
async function findTaskRunsByPullRequestUrl(
  ctx: QueryCtx,
  teamId: string,
  prUrl: string,
): Promise<Doc<"taskRuns">[]> {
  // First, try to find taskRuns with the exact URL in the legacy field
  const directMatches = await ctx.db
    .query("taskRuns")
    .withIndex("by_team_user", (q) => q.eq("teamId", teamId))
    .filter((q) => q.eq(q.field("pullRequestUrl"), prUrl))
    .collect();

  // Then, find taskRuns that have this URL in the pullRequests array
  // We need to check each taskRun individually since we can't index into arrays in queries
  const allTaskRuns = await ctx.db
    .query("taskRuns")
    .withIndex("by_team_user", (q) => q.eq("teamId", teamId))
    .collect();

  const arrayMatches = allTaskRuns.filter(taskRun => {
    if (!taskRun.pullRequests) return false;
    return taskRun.pullRequests.some(pr => pr.url === prUrl);
  });

  // Combine and deduplicate
  const allMatches = [...directMatches, ...arrayMatches];
  const uniqueMatches = Array.from(
    new Map(allMatches.map(run => [run._id, run])).values()
  );

  return uniqueMatches;
}

/**
 * Update the task's merge status when a PR is merged or closed.
 */
async function updateTaskMergeStatus(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  isMerged: boolean,
  isClosed: boolean,
): Promise<void> {
  const task = await ctx.db.get(taskId);
  if (!task) {
    console.warn("[PR merge handler] Task not found", { taskId });
    return;
  }

  // Only update if the PR was merged (not just closed)
  if (isMerged) {
    await ctx.db.patch(taskId, {
      mergeStatus: "pr_merged",
      updatedAt: Date.now(),
    });
    console.log("[PR merge handler] Updated task merge status to pr_merged", {
      taskId,
      taskDescription: task.description
    });
  } else if (isClosed && task.mergeStatus !== "pr_merged") {
    // Only update to closed if it's not already merged
    await ctx.db.patch(taskId, {
      mergeStatus: "pr_closed",
      updatedAt: Date.now(),
    });
    console.log("[PR merge handler] Updated task merge status to pr_closed", {
      taskId,
      taskDescription: task.description
    });
  }
}

/**
 * Handle PR merge/close events from GitHub webhook.
 * This updates the corresponding task's mergeStatus when a PR is merged.
 */
export const handlePullRequestMergeEvent = internalMutation({
  args: {
    teamId: v.string(),
    repoFullName: v.string(),
    prNumber: v.number(),
    prUrl: v.string(),
    isMerged: v.boolean(),
    isClosed: v.boolean(),
    action: v.string(),
  },
  handler: async (ctx, args) => {
    const { teamId, repoFullName, prNumber, prUrl, isMerged, isClosed, action } = args;

    console.log("[PR merge handler] Processing PR event", {
      teamId,
      repoFullName,
      prNumber,
      prUrl,
      isMerged,
      isClosed,
      action,
    });

    // Find all taskRuns that reference this PR
    const taskRuns = await findTaskRunsByPullRequestUrl(ctx, teamId, prUrl);

    if (taskRuns.length === 0) {
      console.log("[PR merge handler] No taskRuns found for PR", {
        prUrl,
        teamId
      });
      return { processed: 0 };
    }

    console.log("[PR merge handler] Found taskRuns for PR", {
      prUrl,
      count: taskRuns.length,
      taskRunIds: taskRuns.map(run => run._id),
    });

    let processedCount = 0;

    for (const taskRun of taskRuns) {
      try {
        // Update the taskRun's PR state
        const updates: Partial<Doc<"taskRuns">> = {
          pullRequestState: isMerged ? "merged" : (isClosed ? "closed" : taskRun.pullRequestState),
          updatedAt: Date.now(),
        };

        // If the taskRun has multiple PRs, update the specific one
        if (taskRun.pullRequests && taskRun.pullRequests.length > 0) {
          const updatedPRs = taskRun.pullRequests.map(pr => {
            if (pr.url === prUrl ||
                (pr.repoFullName === repoFullName && pr.number === prNumber)) {
              return {
                ...pr,
                state: isMerged ? "merged" as const : (isClosed ? "closed" as const : pr.state),
              };
            }
            return pr;
          });
          updates.pullRequests = updatedPRs;

          // Check if all PRs are merged (for multi-PR scenarios)
          const allMerged = updatedPRs.every(pr => pr.state === "merged");
          const anyOpen = updatedPRs.some(pr => pr.state === "open" || pr.state === "draft");

          if (allMerged) {
            updates.pullRequestState = "merged";
          } else if (anyOpen) {
            updates.pullRequestState = "open";
          } else if (updatedPRs.every(pr => pr.state === "closed")) {
            updates.pullRequestState = "closed";
          }
        }

        await ctx.db.patch(taskRun._id, updates);

        // Update the corresponding task's merge status
        if (taskRun.taskId) {
          await updateTaskMergeStatus(ctx, taskRun.taskId, isMerged, isClosed);
        }

        processedCount++;
        console.log("[PR merge handler] Updated taskRun", {
          taskRunId: taskRun._id,
          taskId: taskRun.taskId,
          newState: updates.pullRequestState,
        });
      } catch (error) {
        console.error("[PR merge handler] Error updating taskRun", {
          taskRunId: taskRun._id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { processed: processedCount };
  },
});

/**
 * Process a PR webhook payload to extract merge/close information.
 * This is called from the main webhook handler.
 */
export const processPullRequestWebhook = internalMutation({
  args: {
    teamId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const { teamId, payload } = args;

    try {
      const prEvent = payload as PullRequestEvent;
      const pr = prEvent.pull_request;

      if (!pr) {
        console.warn("[PR merge handler] No pull_request in payload");
        return { processed: false };
      }

      const action = prEvent.action;
      const repoFullName = prEvent.repository?.full_name || "";
      const prNumber = pr.number;
      const prUrl = pr.html_url || "";
      const isMerged = Boolean(pr.merged);
      const isClosed = pr.state === "closed";

      // We're interested in closed and merged events
      if (action === "closed" || (action === "edited" && isMerged)) {
        await ctx.scheduler.runAfter(0, internal.github_pr_merge_handler.handlePullRequestMergeEvent, {
          teamId,
          repoFullName,
          prNumber,
          prUrl,
          isMerged,
          isClosed,
          action,
        });

        return { processed: true, isMerged, isClosed };
      }

      return { processed: false };
    } catch (error) {
      console.error("[PR merge handler] Error processing webhook", {
        error: error instanceof Error ? error.message : String(error),
        teamId,
      });
      return { processed: false, error: String(error) };
    }
  },
});