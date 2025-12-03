import { v } from "convex/values";
import { getTeamId } from "../_shared/team";
import { authQuery } from "./users/utils";
import { internalQuery } from "./_generated/server";
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

export const listScreenshotSetsForPr = authQuery({
  args: {
    teamSlugOrId: v.string(),
    repoFullName: v.string(),
    prNumber: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const limit = Math.min(Math.max(args.limit ?? 3, 1), 10);

    const seenSetIds = new Set<string>();
    type ScreenshotSetWithUrls = Doc<"taskRunScreenshotSets"> & {
      images: Array<
        Doc<"taskRunScreenshotSets">["images"][number] & {
          url?: string;
        }
      >;
    };
    const results: ScreenshotSetWithUrls[] = [];

    const linkedRuns = await ctx.db
      .query("taskRunPullRequests")
      .withIndex("by_pr", (q) =>
        q
          .eq("teamId", teamId)
          .eq("repoFullName", args.repoFullName)
          .eq("prNumber", args.prNumber)
      )
      .order("desc")
      .take(limit * 4);

    const appendScreenshotSet = async (
      screenshotSetId: Id<"taskRunScreenshotSets"> | undefined | null
    ) => {
      if (!screenshotSetId || seenSetIds.has(screenshotSetId)) {
        return;
      }

      const screenshotSet = await ctx.db.get(screenshotSetId);
      if (!screenshotSet) {
        return;
      }

      const imagesWithUrls = await Promise.all(
        screenshotSet.images.map(async (image) => {
          const url = await ctx.storage.getUrl(image.storageId);
          return {
            ...image,
            url: url ?? undefined,
          };
        })
      );

      results.push({
        ...screenshotSet,
        images: imagesWithUrls,
      });
      seenSetIds.add(screenshotSetId);
    };

    for (const entry of linkedRuns) {
      const run = await ctx.db.get(entry.taskRunId);
      if (!run || run.teamId !== teamId) {
        continue;
      }

      await appendScreenshotSet(run.latestScreenshotSetId);
      if (results.length >= limit) {
        break;
      }
    }

    if (results.length === 0) {
      const recentRuns = await ctx.db
        .query("taskRuns")
        .withIndex("by_team_user", (q) => q.eq("teamId", teamId))
        .order("desc")
        .take(120);

      for (const run of recentRuns) {
        const matchesPr = run.pullRequests?.some(
          (pr) => pr.repoFullName === args.repoFullName && pr.number === args.prNumber
        );

        if (!matchesPr) {
          continue;
        }

        await appendScreenshotSet(run.latestScreenshotSetId);
        if (results.length >= limit) {
          break;
        }
      }
    }

    results.sort((a, b) => {
      const aTimestamp = a.capturedAt ?? a.createdAt ?? 0;
      const bTimestamp = b.capturedAt ?? b.createdAt ?? 0;
      return bTimestamp - aTimestamp;
    });

    return results;
  },
});
