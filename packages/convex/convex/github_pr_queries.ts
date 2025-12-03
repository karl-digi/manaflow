import { v } from "convex/values";
import { authQuery } from "./users/utils";
import { getTeamId } from "../_shared/team";
import type { Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";

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

export const listScreenshotSetsForPr = authQuery({
  args: {
    teamSlugOrId: v.string(),
    repoFullName: v.string(),
    prNumber: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const limit = Math.min(args.limit ?? 3, 10);

    const prRunLinks = await ctx.db
      .query("taskRunPullRequests")
      .withIndex("by_pr", (q) =>
        q
          .eq("teamId", teamId)
          .eq("repoFullName", args.repoFullName)
          .eq("prNumber", args.prNumber)
      )
      .order("desc")
      .take(40);

    const runIds: Id<"taskRuns">[] = [];
    const seenRunIds = new Set<string>();
    for (const link of prRunLinks) {
      if (seenRunIds.has(link.taskRunId)) {
        continue;
      }
      runIds.push(link.taskRunId);
      seenRunIds.add(link.taskRunId);
    }

    if (runIds.length === 0) {
      const recentRuns = await ctx.db
        .query("taskRuns")
        .withIndex("by_team_user", (q) => q.eq("teamId", teamId))
        .order("desc")
        .take(200);

      for (const run of recentRuns) {
        if (!run.pullRequests || run.pullRequests.length === 0) {
          continue;
        }
        const matchesPr = run.pullRequests.some(
          (pr) =>
            pr.repoFullName === args.repoFullName &&
            pr.number === args.prNumber
        );
        if (matchesPr && !seenRunIds.has(run._id)) {
          runIds.push(run._id);
          seenRunIds.add(run._id);
        }
        if (runIds.length >= 12) {
          break;
        }
      }
    }

    const screenshotSets = await Promise.all(
      runIds.slice(0, 12).map(async (runId) => {
        const run = await ctx.db.get(runId);
        if (!run || run.teamId !== teamId) {
          return null;
        }
        if (!run.latestScreenshotSetId) {
          return null;
        }
        const set = await ctx.db.get(run.latestScreenshotSetId);
        if (!set || set.runId !== run._id) {
          return null;
        }

        const imagesWithUrls = await Promise.all(
          set.images.map(async (image) => {
            const url = await ctx.storage.getUrl(image.storageId);
            return {
              ...image,
              url: url ?? undefined,
            };
          })
        );

        return {
          ...set,
          images: imagesWithUrls,
        };
      })
    );

    const sortedSets = screenshotSets
      .filter((set): set is NonNullable<typeof set> => Boolean(set))
      .sort((a, b) => b.capturedAt - a.capturedAt)
      .slice(0, limit);

    return sortedSets;
  },
});
