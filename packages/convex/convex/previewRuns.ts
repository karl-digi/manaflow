import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { fetchInstallationAccessToken } from "../_shared/githubApp";
import { internal } from "./_generated/api";
import { authQuery } from "./users/utils";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { Octokit } from "octokit";

function normalizeRepoFullName(value: string): string {
  return value.trim().replace(/\.git$/i, "").toLowerCase();
}

const isActiveStatus = (status: string): boolean =>
  status === "pending" || status === "running";

async function fetchPrMetadata(params: {
  installationId: number;
  repoFullName: string;
  prNumber: number;
}): Promise<{
  headSha?: string;
  baseSha?: string;
  headRef?: string;
  headRepoFullName?: string;
  headRepoCloneUrl?: string;
} | null> {
  const token = await fetchInstallationAccessToken(params.installationId);
  if (!token) {
    console.warn("[preview-runs] Missing installation token; cannot load PR metadata", {
      installationId: params.installationId,
      repoFullName: params.repoFullName,
      prNumber: params.prNumber,
    });
    return null;
  }

  const [owner, repo] = params.repoFullName.split("/");
  if (!owner || !repo) {
    console.warn("[preview-runs] Invalid repo name for PR metadata fetch", {
      repoFullName: params.repoFullName,
    });
    return null;
  }

  try {
    const octokit = new Octokit({ auth: token });
    const pr = await octokit.pulls.get({
      owner,
      repo,
      pull_number: params.prNumber,
    });

    return {
      headSha: pr.data.head?.sha ?? undefined,
      baseSha: pr.data.base?.sha ?? undefined,
      headRef: pr.data.head?.ref ?? undefined,
      headRepoFullName: pr.data.head?.repo?.full_name ?? undefined,
      headRepoCloneUrl: pr.data.head?.repo?.clone_url ?? undefined,
    };
  } catch (error) {
    console.error("[preview-runs] Failed to fetch PR metadata", {
      repoFullName: params.repoFullName,
      prNumber: params.prNumber,
      error,
    });
    return null;
  }
}

export const enqueueFromWebhook = internalMutation({
  args: {
    previewConfigId: v.id("previewConfigs"),
    teamId: v.string(),
    repoFullName: v.string(),
    repoInstallationId: v.optional(v.number()),
    prNumber: v.number(),
    prUrl: v.string(),
    headSha: v.string(),
    baseSha: v.optional(v.string()),
    headRef: v.optional(v.string()),
    headRepoFullName: v.optional(v.string()),
    headRepoCloneUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const repoFullName = normalizeRepoFullName(args.repoFullName);
    const headRepoFullName = args.headRepoFullName
      ? normalizeRepoFullName(args.headRepoFullName)
      : undefined;

    const existingForPr = await ctx.db
      .query("previewRuns")
      .withIndex("by_config_pr", (q) =>
        q.eq("previewConfigId", args.previewConfigId).eq("prNumber", args.prNumber),
      )
      .order("desc")
      .take(5);

    const activePrRun = existingForPr.find((run) => isActiveStatus(run.status));
    if (activePrRun) {
      return activePrRun._id;
    }

    const existing = await ctx.db
      .query("previewRuns")
      .withIndex("by_config_head", (q) =>
        q.eq("previewConfigId", args.previewConfigId).eq("headSha", args.headSha),
      )
      .order("desc")
      .first();

    if (existing && isActiveStatus(existing.status)) {
      return existing._id;
    }

    const now = Date.now();
    const runId = await ctx.db.insert("previewRuns", {
      previewConfigId: args.previewConfigId,
      teamId: args.teamId,
      repoFullName,
      repoInstallationId: args.repoInstallationId,
      prNumber: args.prNumber,
      prUrl: args.prUrl,
      headSha: args.headSha,
      baseSha: args.baseSha,
      headRef: args.headRef,
      headRepoFullName,
      headRepoCloneUrl: args.headRepoCloneUrl,
      status: "pending",
      dispatchedAt: undefined,
      startedAt: undefined,
      completedAt: undefined,
      screenshotSetId: undefined,
      githubCommentUrl: undefined,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.previewConfigId, {
      lastRunAt: now,
      updatedAt: now,
    });

    return runId;
  },
});

export const enqueueFromCrown = internalAction({
  args: {
    teamId: v.string(),
    repoFullName: v.string(),
    prNumber: v.number(),
    prUrl: v.string(),
    repoInstallationId: v.optional(v.number()),
    headSha: v.optional(v.string()),
    baseSha: v.optional(v.string()),
    headRef: v.optional(v.string()),
    headRepoFullName: v.optional(v.string()),
    headRepoCloneUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const repoFullName = normalizeRepoFullName(args.repoFullName);
    let headRepoFullName = args.headRepoFullName
      ? normalizeRepoFullName(args.headRepoFullName)
      : undefined;

    const previewConfig = await ctx.runQuery(
      internal.previewConfigs.getByTeamAndRepo,
      { teamId: args.teamId, repoFullName },
    );

    if (!previewConfig) {
      console.log("[preview-runs] No preview config for repo; skipping crown enqueue", {
        repoFullName,
        prNumber: args.prNumber,
        teamId: args.teamId,
      });
      return null;
    }

    const existingRuns =
      (await ctx.runQuery(internal.previewRuns.listByConfigAndPr, {
        previewConfigId: previewConfig._id,
        prNumber: args.prNumber,
        limit: 5,
      })) ?? [];

    const activeExisting = existingRuns.find((run) => isActiveStatus(run.status));
    if (activeExisting) {
      if (activeExisting.status === "pending") {
        await ctx.scheduler.runAfter(
          0,
          internal.preview_jobs.requestDispatch,
          { previewRunId: activeExisting._id },
        );
      }
      return activeExisting._id;
    }

    const installationId =
      args.repoInstallationId ?? previewConfig.repoInstallationId;

    let headSha = args.headSha;
    let baseSha = args.baseSha;
    let headRef = args.headRef;
    let headRepoCloneUrl = args.headRepoCloneUrl;

    const needsPrMetadata =
      !headSha || !baseSha || !headRef || !headRepoFullName || !headRepoCloneUrl;

    if (needsPrMetadata && installationId) {

      const prMeta = await fetchPrMetadata({
        installationId,
        repoFullName,
        prNumber: args.prNumber,
      });

      headSha = headSha ?? prMeta?.headSha;
      baseSha = baseSha ?? prMeta?.baseSha;
      headRef = headRef ?? prMeta?.headRef;
      headRepoFullName = headRepoFullName ?? (prMeta?.headRepoFullName
        ? normalizeRepoFullName(prMeta.headRepoFullName)
        : undefined);
      headRepoCloneUrl = headRepoCloneUrl ?? prMeta?.headRepoCloneUrl;
    }

    if (!headSha) {
      console.warn("[preview-runs] Unable to enqueue preview run without head SHA", {
        repoFullName,
        prNumber: args.prNumber,
      });
      return null;
    }

    const runId = await ctx.runMutation(internal.previewRuns.enqueueFromWebhook, {
      previewConfigId: previewConfig._id,
      teamId: previewConfig.teamId,
      repoFullName,
      repoInstallationId: installationId,
      prNumber: args.prNumber,
      prUrl: args.prUrl,
      headSha,
      baseSha,
      headRef,
      headRepoFullName,
      headRepoCloneUrl,
    });

    const run = await ctx.runQuery(internal.previewRuns.getById, { id: runId });

    if (run?.status === "pending") {
      await ctx.scheduler.runAfter(
        0,
        internal.preview_jobs.requestDispatch,
        { previewRunId: runId },
      );
    }

    return runId;
  },
});

export const linkTaskRun = internalMutation({
  args: {
    previewRunId: v.id("previewRuns"),
    taskRunId: v.id("taskRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.previewRunId);
    if (!run) {
      throw new Error("Preview run not found");
    }
    await ctx.db.patch(run._id, {
      taskRunId: args.taskRunId,
      updatedAt: Date.now(),
    });
  },
});

export const markDispatched = internalMutation({
  args: {
    previewRunId: v.id("previewRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.previewRunId);
    if (!run) {
      throw new Error("Preview run not found");
    }
    await ctx.db.patch(run._id, {
      status: "running",
      dispatchedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const updateStatus = internalMutation({
  args: {
    previewRunId: v.id("previewRuns"),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    screenshotSetId: v.optional(v.id("taskRunScreenshotSets")),
    githubCommentUrl: v.optional(v.string()),
    githubCommentId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.previewRunId);
    if (!run) {
      throw new Error("Preview run not found");
    }
    const now = Date.now();
    const patch: Record<string, unknown> = {
      status: args.status,
      screenshotSetId: args.screenshotSetId,
      githubCommentUrl: args.githubCommentUrl ?? run.githubCommentUrl,
      githubCommentId: args.githubCommentId ?? run.githubCommentId,
      updatedAt: now,
    };
    if (args.status === "completed" || args.status === "failed" || args.status === "skipped") {
      patch.completedAt = now;
    } else if (args.status === "running" && !run.startedAt) {
      patch.startedAt = now;
    }
    await ctx.db.patch(run._id, patch);
  },
});

export const getById = internalQuery({
  args: {
    id: v.id("previewRuns"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getRunWithConfig = internalQuery({
  args: {
    previewRunId: v.id("previewRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.previewRunId);
    if (!run) {
      return null;
    }
    const config = await ctx.db.get(run.previewConfigId);
    if (!config) {
      return null;
    }
    return { run, config } as const;
  },
});

export const getByTaskRunId = internalQuery({
  args: {
    taskRunId: v.id("taskRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("previewRuns")
      .filter((q) => q.eq(q.field("taskRunId"), args.taskRunId))
      .first();
    return run ?? null;
  },
});

export const listRecentByConfig = internalQuery({
  args: {
    previewConfigId: v.id("previewConfigs"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const take = Math.max(1, Math.min(args.limit ?? 20, 100));
    const runs = await ctx.db
      .query("previewRuns")
      .withIndex("by_config_status", (q) =>
        q.eq("previewConfigId", args.previewConfigId),
      )
      .order("desc")
      .take(take);
    return runs;
  },
});

export const listByConfigAndPr = internalQuery({
  args: {
    previewConfigId: v.id("previewConfigs"),
    prNumber: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const take = Math.max(1, Math.min(args.limit ?? 20, 100));
    const runs = await ctx.db
      .query("previewRuns")
      .withIndex("by_config_pr", (q) =>
        q.eq("previewConfigId", args.previewConfigId).eq("prNumber", args.prNumber),
      )
      .order("desc")
      .take(take);
    return runs;
  },
});

export const listByConfig = authQuery({
  args: {
    teamSlugOrId: v.string(),
    previewConfigId: v.id("previewConfigs"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const config = await ctx.db.get(args.previewConfigId);
    if (!config || config.teamId !== teamId) {
      throw new Error("Preview configuration not found");
    }
    const take = Math.max(1, Math.min(args.limit ?? 25, 100));
    const runs = await ctx.db
      .query("previewRuns")
      .withIndex("by_team_created", (q) =>
        q.eq("teamId", teamId),
      )
      .filter((q) => q.eq(q.field("previewConfigId"), config._id))
      .order("desc")
      .take(take);
    return runs;
  },
});
