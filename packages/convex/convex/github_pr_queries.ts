import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { authQuery } from "./users/utils";
import { getTeamId } from "../_shared/team";
import type { Doc, Id } from "./_generated/dataModel";

export const findTaskRunsForPr = internalQuery({
  args: {
    teamId: v.string(),
    repoFullName: v.string(),
    prNumber: v.number(),
  },
  handler: async (ctx, { teamId, repoFullName, prNumber }) => {
    // Limit scan to recent runs to avoid loading entire history for large teams
    const recentRuns = await ctx.db
      .query("taskRuns")
      .withIndex("by_team_user", (q) => q.eq("teamId", teamId))
      .order("desc")
      .take(300);

    const matchingRuns = recentRuns.filter((run) => {
      if (!run.pullRequests || run.pullRequests.length === 0) {
        return false;
      }

      return run.pullRequests.some(
        (pr) =>
          pr.repoFullName === repoFullName &&
          pr.number === prNumber,
      );
    });

    return matchingRuns.slice(0, 5); // Return up to 5 most recent runs
  },
});

export const getScreenshotSet = internalQuery({
  args: {
    screenshotSetId: v.id("taskRunScreenshotSets"),
  },
  handler: async (ctx, { screenshotSetId }) => {
    const screenshotSet = await ctx.db.get(screenshotSetId);
    if (!screenshotSet) {
      return null;
    }

    // Get URLs for all screenshots
    const imagesWithUrls = await Promise.all(
      screenshotSet.images.map(async (image) => {
        const url = await ctx.storage.getUrl(image.storageId);
        return {
          ...image,
          url: url ?? undefined,
        };
      }),
    );

    return {
      ...screenshotSet,
      images: imagesWithUrls,
    };
  },
});

export const getLatestScreenshotSetForPr = authQuery({
  args: {
    teamSlugOrId: v.string(),
    repoFullName: v.string(),
    prNumber: v.number(),
  },
  handler: async (ctx, { teamSlugOrId, repoFullName, prNumber }) => {
    const teamId = await getTeamId(ctx, teamSlugOrId);

    const runLinks = await ctx.db
      .query("taskRunPullRequests")
      .withIndex("by_pr", (q) =>
        q
          .eq("teamId", teamId)
          .eq("repoFullName", repoFullName)
          .eq("prNumber", prNumber),
      )
      .order("desc")
      .take(20);

    if (runLinks.length === 0) {
      return null;
    }

    const screenshotSets: Array<{
      runId: Id<"taskRuns">;
      taskId: Id<"tasks">;
      set: Doc<"taskRunScreenshotSets">;
    }> = [];

    for (const link of runLinks) {
      const run = await ctx.db.get(link.taskRunId);
      if (!run?.latestScreenshotSetId) {
        continue;
      }

      const set = await ctx.db.get(run.latestScreenshotSetId);
      if (!set) {
        continue;
      }

      screenshotSets.push({
        runId: run._id,
        taskId: run.taskId,
        set,
      });
    }

    if (screenshotSets.length === 0) {
      return null;
    }

    screenshotSets.sort((a, b) => {
      if (a.set.capturedAt !== b.set.capturedAt) {
        return b.set.capturedAt - a.set.capturedAt;
      }
      if (a.set.updatedAt !== b.set.updatedAt) {
        return b.set.updatedAt - a.set.updatedAt;
      }
      return b.set._id.localeCompare(a.set._id);
    });

    const latest = screenshotSets[0]!;

    const imagesWithUrls = await Promise.all(
      latest.set.images.map(async (image) => {
        const url = await ctx.storage.getUrl(image.storageId);
        return { ...image, url: url ?? undefined };
      }),
    );

    return {
      _id: latest.set._id,
      taskId: latest.taskId,
      runId: latest.runId,
      status: latest.set.status,
      hasUiChanges: latest.set.hasUiChanges ?? null,
      commitSha: latest.set.commitSha ?? null,
      capturedAt: latest.set.capturedAt,
      error: latest.set.error ?? null,
      images: imagesWithUrls,
    };
  },
});
