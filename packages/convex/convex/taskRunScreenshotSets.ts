import { v } from "convex/values";
import { getTeamId } from "../_shared/team";
import { authQuery } from "./users/utils";

/**
 * Get a screenshot set by ID with resolved image URLs
 */
export const get = authQuery({
  args: {
    teamSlugOrId: v.string(),
    id: v.id("taskRunScreenshotSets"),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const screenshotSet = await ctx.db.get(args.id);

    if (!screenshotSet) {
      return null;
    }

    // Verify the screenshot set belongs to the team via task run
    const taskRun = await ctx.db.get(screenshotSet.runId);
    if (!taskRun || taskRun.teamId !== teamId) {
      return null;
    }

    // Resolve storage URLs for each image
    const imagesWithUrls = await Promise.all(
      screenshotSet.images.map(async (image) => {
        const url = await ctx.storage.getUrl(image.storageId);
        return {
          ...image,
          url,
        };
      })
    );

    return {
      ...screenshotSet,
      images: imagesWithUrls,
    };
  },
});

/**
 * Get all screenshot sets for a task run
 */
export const getByTaskRun = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskRunId: v.id("taskRuns"),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const taskRun = await ctx.db.get(args.taskRunId);

    if (!taskRun || taskRun.teamId !== teamId) {
      return [];
    }

    const sets = await ctx.db
      .query("taskRunScreenshotSets")
      .withIndex("by_run_capturedAt", (q) => q.eq("runId", args.taskRunId))
      .order("desc")
      .collect();

    // Resolve storage URLs for each image in each set
    const setsWithUrls = await Promise.all(
      sets.map(async (set) => {
        const imagesWithUrls = await Promise.all(
          set.images.map(async (image) => {
            const url = await ctx.storage.getUrl(image.storageId);
            return {
              ...image,
              url,
            };
          })
        );
        return {
          ...set,
          images: imagesWithUrls,
        };
      })
    );

    return setsWithUrls;
  },
});

/**
 * Get the latest screenshot set for a task
 */
export const getLatestByTask = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const task = await ctx.db.get(args.taskId);

    if (!task || task.teamId !== teamId) {
      return null;
    }

    const latestSet = await ctx.db
      .query("taskRunScreenshotSets")
      .withIndex("by_task_capturedAt", (q) => q.eq("taskId", args.taskId))
      .order("desc")
      .first();

    if (!latestSet) {
      return null;
    }

    // Resolve storage URLs for each image
    const imagesWithUrls = await Promise.all(
      latestSet.images.map(async (image) => {
        const url = await ctx.storage.getUrl(image.storageId);
        return {
          ...image,
          url,
        };
      })
    );

    return {
      ...latestSet,
      images: imagesWithUrls,
    };
  },
});
