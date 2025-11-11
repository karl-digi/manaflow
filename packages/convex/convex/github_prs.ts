import { v } from "convex/values";
import { getTeamId } from "../_shared/team";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { authMutation, authQuery } from "./users/utils";

const SYSTEM_BRANCH_USER_ID = "__system__";

type WebhookUser = {
  login?: string;
  id?: number;
};

type WebhookRepo = {
  id?: number;
  pushed_at?: string;
};

type WebhookBranchRef = {
  ref?: string;
  sha?: string;
  repo?: WebhookRepo;
};

type WebhookPullRequest = {
  number?: number;
  id?: number;
  title?: string;
  state?: string;
  merged?: boolean;
  draft?: boolean;
  html_url?: string;
  merge_commit_sha?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  merged_at?: string;
  comments?: number;
  review_comments?: number;
  commits?: number;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  user?: WebhookUser;
  base?: WebhookBranchRef;
  head?: WebhookBranchRef;
};

type PullRequestWebhookEnvelope = {
  pull_request?: WebhookPullRequest;
  number?: number;
};

async function upsertBranchMetadata(
  ctx: MutationCtx,
  {
    teamId,
    repoFullName,
    branchName,
    baseSha,
    mergeCommitSha,
    headSha,
    activityTimestamp,
  }: {
    teamId: string;
    repoFullName: string;
    branchName: string;
    baseSha?: string;
    mergeCommitSha?: string;
    headSha?: string;
    activityTimestamp?: number;
  }
) {
  if (!baseSha && !mergeCommitSha && !headSha) {
    return;
  }

  const repoDoc = await ctx.db
    .query("repos")
    .withIndex("by_team", (q) => q.eq("teamId", teamId))
    .filter((q) => q.eq(q.field("fullName"), repoFullName))
    .first();
  const repoId = repoDoc?._id;

  const rows = await ctx.db
    .query("branches")
    .withIndex("by_repo", (q) => q.eq("repo", repoFullName))
    .filter((q) => q.eq(q.field("teamId"), teamId))
    .filter((q) => q.eq(q.field("name"), branchName))
    .collect();

  const timestamp = activityTimestamp ?? Date.now();

  for (const row of rows) {
    const patch: Record<string, unknown> = {};
    if (repoId && row.repoId !== repoId) {
      patch.repoId = repoId;
    }
    if (baseSha && row.lastKnownBaseSha !== baseSha) {
      patch.lastKnownBaseSha = baseSha;
    }
    if (
      mergeCommitSha &&
      row.lastKnownMergeCommitSha !== mergeCommitSha
    ) {
      patch.lastKnownMergeCommitSha = mergeCommitSha;
    }
    if (headSha && row.lastCommitSha !== headSha) {
      patch.lastCommitSha = headSha;
    }
    if (
      typeof row.lastActivityAt !== "number" ||
      timestamp > row.lastActivityAt
    ) {
      patch.lastActivityAt = timestamp;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(row._id, patch);
    }
  }

  const hasSystemRow = rows.some((row) => row.userId === SYSTEM_BRANCH_USER_ID);
  if (!hasSystemRow) {
    await ctx.db.insert("branches", {
      repo: repoFullName,
      repoId,
      name: branchName,
      userId: SYSTEM_BRANCH_USER_ID,
      teamId,
      lastKnownBaseSha: baseSha,
      lastKnownMergeCommitSha: mergeCommitSha,
      lastCommitSha: headSha,
      lastActivityAt: timestamp,
    });
  }
}

async function upsertCore(
  ctx: MutationCtx,
  {
    teamId,
    installationId,
    repoFullName,
    number,
    record,
  }: {
    teamId: string;
    installationId: number;
    repoFullName: string;
    number: number;
    record: {
      providerPrId?: number;
      repositoryId?: number;
      title: string;
      state: "open" | "closed";
      merged?: boolean;
      draft?: boolean;
      authorLogin?: string;
      authorId?: number;
      htmlUrl?: string;
      baseRef?: string;
      headRef?: string;
      baseSha?: string;
      headSha?: string;
      mergeCommitSha?: string;
      createdAt?: number;
      updatedAt?: number;
      closedAt?: number;
      mergedAt?: number;
      commentsCount?: number;
      reviewCommentsCount?: number;
      commitsCount?: number;
      additions?: number;
      deletions?: number;
      changedFiles?: number;
    };
  }
) {
  const existing = await ctx.db
    .query("pullRequests")
    .withIndex("by_team_repo_number", (q) =>
      q.eq("teamId", teamId).eq("repoFullName", repoFullName).eq("number", number)
    )
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      ...record,
      installationId,
      repoFullName,
      number,
      provider: "github",
      teamId,
    });
    return existing._id;
  }
  const id = await ctx.db.insert("pullRequests", {
    provider: "github",
    teamId,
    installationId,
    repoFullName,
    number,
    ...record,
  });
  return id;
}

export const upsertPullRequestInternal = internalMutation({
  args: {
    teamId: v.string(),
    installationId: v.number(),
    repoFullName: v.string(),
    number: v.number(),
    record: v.object({
      providerPrId: v.optional(v.number()),
      repositoryId: v.optional(v.number()),
      title: v.string(),
      state: v.union(v.literal("open"), v.literal("closed")),
      merged: v.optional(v.boolean()),
      draft: v.optional(v.boolean()),
      authorLogin: v.optional(v.string()),
      authorId: v.optional(v.number()),
      htmlUrl: v.optional(v.string()),
      baseRef: v.optional(v.string()),
      headRef: v.optional(v.string()),
      baseSha: v.optional(v.string()),
      headSha: v.optional(v.string()),
      mergeCommitSha: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      closedAt: v.optional(v.number()),
      mergedAt: v.optional(v.number()),
      commentsCount: v.optional(v.number()),
      reviewCommentsCount: v.optional(v.number()),
      commitsCount: v.optional(v.number()),
      additions: v.optional(v.number()),
      deletions: v.optional(v.number()),
      changedFiles: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { teamId, installationId, repoFullName, number, record }) =>
    upsertCore(ctx, { teamId, installationId, repoFullName, number, record }),
});

export const listPullRequests = authQuery({
  args: {
    teamSlugOrId: v.string(),
    state: v.optional(v.union(v.literal("open"), v.literal("closed"), v.literal("all"))),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { teamSlugOrId, state, search, limit }) => {
    const teamId = await getTeamId(ctx, teamSlugOrId);

    const useState = state ?? "open";
    const cursor = ctx.db
      .query("pullRequests")
      .withIndex(
        useState === "all" ? "by_team" : "by_team_state",
        (q) =>
          useState === "all"
            ? q.eq("teamId", teamId)
            : q.eq("teamId", teamId).eq("state", useState)
      )
      .order("desc");

    const rows = await cursor.collect();
    const q = (search ?? "").trim().toLowerCase();
    const filtered = !q
      ? rows
      : rows.filter((r) => {
          return (
            r.title.toLowerCase().includes(q) ||
            (r.authorLogin ?? "").toLowerCase().includes(q) ||
            r.repoFullName.toLowerCase().includes(q)
          );
        });
    const limited = typeof limit === "number" ? filtered.slice(0, Math.max(1, limit)) : filtered;
    return limited;
  },
});

export const getPullRequest = authQuery({
  args: {
    teamSlugOrId: v.string(),
    repoFullName: v.string(),
    number: v.number(),
  },
  handler: async (ctx, { teamSlugOrId, repoFullName, number }) => {
    const teamId = await getTeamId(ctx, teamSlugOrId);

    const pr = await ctx.db
      .query("pullRequests")
      .withIndex("by_team_repo_number", (q) =>
        q.eq("teamId", teamId).eq("repoFullName", repoFullName).eq("number", number)
      )
      .first();

    return pr ?? null;
  },
});

// Helper to look up a provider connection for a repository owner
export const getConnectionForOwnerInternal = internalQuery({
  args: { owner: v.string() },
  handler: async (ctx, { owner }) => {
    // If the same owner has multiple installations, this returns one arbitrarily.
    const row = await ctx.db
      .query("providerConnections")
      .filter((q) => q.eq(q.field("accountLogin"), owner))
      .first();
    return row ?? null;
  },
});

export const upsertFromWebhookPayload = internalMutation({
  args: {
    installationId: v.number(),
    repoFullName: v.string(),
    teamId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, { installationId, repoFullName, teamId, payload }) => {
    try {
      const envelope = (payload ?? {}) as PullRequestWebhookEnvelope;
      const pr = envelope.pull_request ?? {};
      const number = Number(pr.number ?? envelope.number ?? 0);
      if (!number) return { ok: false as const };
      const mapStr = (value: unknown) =>
        typeof value === "string" ? value : undefined;
      const mapNum = (value: unknown) =>
        typeof value === "number" ? value : undefined;
      const ts = (s: unknown) => {
        if (typeof s !== "string") return undefined;
        const n = Date.parse(s);
        return Number.isFinite(n) ? n : undefined;
      };
      const baseRef = mapStr(pr.base?.ref);
      const headRef = mapStr(pr.head?.ref);
      const baseSha = mapStr(pr.base?.sha);
      const headSha = mapStr(pr.head?.sha);
      const mergeCommitSha = mapStr(pr.merge_commit_sha);
      const baseActivityTs =
        ts(pr.base?.repo?.pushed_at) ??
        ts(pr.merged_at) ??
        ts(pr.updated_at) ??
        Date.now();

      await upsertCore(ctx, {
        teamId,
        installationId,
        repoFullName,
        number,
        record: {
          providerPrId: mapNum(pr.id),
          repositoryId: mapNum(pr.base?.repo?.id),
          title: mapStr(pr.title) ?? "",
          state: mapStr(pr.state) === "closed" ? "closed" : "open",
          merged: Boolean(pr.merged),
          draft: Boolean(pr.draft),
          authorLogin: mapStr(pr.user?.login),
          authorId: mapNum(pr.user?.id),
          htmlUrl: mapStr(pr.html_url),
          baseRef,
          headRef,
          baseSha,
          headSha,
          mergeCommitSha,
          createdAt: ts(pr.created_at),
          updatedAt: ts(pr.updated_at),
          closedAt: ts(pr.closed_at),
          mergedAt: ts(pr.merged_at),
          commentsCount: mapNum(pr.comments),
          reviewCommentsCount: mapNum(pr.review_comments),
          commitsCount: mapNum(pr.commits),
          additions: mapNum(pr.additions),
          deletions: mapNum(pr.deletions),
          changedFiles: mapNum(pr.changed_files),
        },
      });

      if (baseRef && (baseSha || mergeCommitSha)) {
        await upsertBranchMetadata(ctx, {
          teamId,
          repoFullName,
          branchName: baseRef,
          baseSha,
          mergeCommitSha,
          activityTimestamp: baseActivityTs,
        });
      }
      if (headRef && headSha) {
        await upsertBranchMetadata(ctx, {
          teamId,
          repoFullName,
          branchName: headRef,
          headSha,
          activityTimestamp: ts(pr.updated_at) ?? Date.now(),
        });
      }
      return { ok: true as const };
    } catch (_e) {
      return { ok: false as const };
    }
  },
});

export const upsertFromServer = authMutation({
  args: {
    teamSlugOrId: v.string(),
    installationId: v.number(),
    repoFullName: v.string(),
    number: v.number(),
    record: v.object({
      providerPrId: v.optional(v.number()),
      repositoryId: v.optional(v.number()),
      title: v.string(),
      state: v.union(v.literal("open"), v.literal("closed")),
      merged: v.optional(v.boolean()),
      draft: v.optional(v.boolean()),
      authorLogin: v.optional(v.string()),
      authorId: v.optional(v.number()),
      htmlUrl: v.optional(v.string()),
      baseRef: v.optional(v.string()),
      headRef: v.optional(v.string()),
      baseSha: v.optional(v.string()),
      headSha: v.optional(v.string()),
      mergeCommitSha: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      closedAt: v.optional(v.number()),
      mergedAt: v.optional(v.number()),
      commentsCount: v.optional(v.number()),
      reviewCommentsCount: v.optional(v.number()),
      commitsCount: v.optional(v.number()),
      additions: v.optional(v.number()),
      deletions: v.optional(v.number()),
      changedFiles: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { teamSlugOrId, installationId, repoFullName, number, record }) => {
    const teamId = await getTeamId(ctx, teamSlugOrId);
    return await upsertCore(ctx, { teamId, installationId, repoFullName, number, record });
  },
});

/**
 * Handle PR closed events from GitHub webhook.
 * When a PR is merged, find all taskRuns that reference this PR
 * and update their state and the corresponding task's mergeStatus.
 */
export const handlePullRequestClosed = internalMutation({
  args: {
    teamId: v.string(),
    repoFullName: v.string(),
    prNumber: v.number(),
    isMerged: v.boolean(),
  },
  handler: async (ctx, { teamId, repoFullName, prNumber, isMerged }) => {
    // Only process merge events, not just closed PRs
    if (!isMerged) {
      return { updated: 0, message: "PR closed but not merged, no updates needed" };
    }

    // Find all taskRuns that reference this PR
    // We need to check both single PR fields and the pullRequests array
    const allTaskRuns = await ctx.db
      .query("taskRuns")
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .collect();

    const matchingTaskRuns = allTaskRuns.filter((run) => {
      // Check single PR fields (legacy)
      if (
        run.pullRequestNumber === prNumber &&
        run.pullRequestUrl?.includes(repoFullName)
      ) {
        return true;
      }

      // Check pullRequests array (multi-repo support)
      if (run.pullRequests) {
        return run.pullRequests.some(
          (pr) => pr.repoFullName === repoFullName && pr.number === prNumber
        );
      }

      return false;
    });

    let updatedCount = 0;
    const updatedTaskIds = new Set<string>();

    for (const run of matchingTaskRuns) {
      // Update the taskRun's PR state
      const updates: Record<string, unknown> = {
        updatedAt: Date.now(),
      };

      // Update single PR fields if they match
      if (
        run.pullRequestNumber === prNumber &&
        run.pullRequestUrl?.includes(repoFullName)
      ) {
        updates.pullRequestState = "merged";
        updates.pullRequestIsDraft = false;
      }

      // Update pullRequests array if it exists
      if (run.pullRequests) {
        updates.pullRequests = run.pullRequests.map((pr) =>
          pr.repoFullName === repoFullName && pr.number === prNumber
            ? { ...pr, state: "merged" as const, isDraft: false }
            : pr
        );

        // Aggregate the state across all PRs
        const { aggregatePullRequestState } = await import("@cmux/shared/pull-request-state");
        const aggregate = aggregatePullRequestState(
          updates.pullRequests as Array<{
            repoFullName: string;
            url?: string;
            number?: number;
            state: "none" | "draft" | "open" | "merged" | "closed" | "unknown";
            isDraft?: boolean;
          }>
        );

        updates.pullRequestState = aggregate.state;
        updates.pullRequestIsDraft = aggregate.isDraft;
        if (aggregate.url !== undefined) {
          updates.pullRequestUrl = aggregate.url;
        }
        if (aggregate.number !== undefined) {
          updates.pullRequestNumber = aggregate.number;
        }
      }

      await ctx.db.patch(run._id, updates);
      updatedCount++;

      // Track which tasks need updating
      updatedTaskIds.add(run.taskId);
    }

    // Update the mergeStatus of corresponding tasks
    // Only update to pr_merged if ALL PRs in the taskRun are merged
    for (const taskId of updatedTaskIds) {
      const task = await ctx.db.get(taskId as any);
      if (!task) continue;

      // Get the taskRun to check its aggregated state
      const taskRun = matchingTaskRuns.find((r) => r.taskId === taskId);
      if (!taskRun) continue;

      // Only update task to pr_merged if the aggregated state is "merged"
      // This means ALL PRs are merged (for multi-repo tasks)
      const shouldUpdateToMerged = taskRun.pullRequests
        ? taskRun.pullRequests.every((pr) => pr.state === "merged")
        : taskRun.pullRequestState === "merged";

      if (shouldUpdateToMerged) {
        await ctx.db.patch(taskId as any, {
          mergeStatus: "pr_merged",
          updatedAt: Date.now(),
        });
      }
    }

    return {
      updated: updatedCount,
      tasks: updatedTaskIds.size,
      message: `Updated ${updatedCount} taskRun(s) and ${updatedTaskIds.size} task(s)`,
    };
  },
});
