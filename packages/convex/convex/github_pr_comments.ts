import type {
  IssueCommentEvent,
  PullRequestReviewCommentEvent,
  PullRequestReviewEvent,
} from "@octokit/webhooks-types";
import { v } from "convex/values";
import { fetchInstallationAccessToken } from "../_shared/githubApp";
import { getTeamId } from "../_shared/team";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { authMutation, authQuery } from "./users/utils";

const GITHUB_API_BASE = "https://api.github.com";
const MAX_PER_PAGE = 100;
const COMMENT_SYNC_TTL_MS = 2 * 60 * 1000;
const MILLIS_THRESHOLD = 1_000_000_000_000;

type GithubIssueComment = IssueCommentEvent["comment"];
type GithubReviewComment = PullRequestReviewCommentEvent["comment"];
type GithubReview = PullRequestReviewEvent["review"];
type GithubReactionSummary = NonNullable<GithubIssueComment>["reactions"];

type ReactionSummary = {
  totalCount: number;
  plusOne?: number;
  minusOne?: number;
  laugh?: number;
  confused?: number;
  heart?: number;
  hooray?: number;
  rocket?: number;
  eyes?: number;
};

type CommentBase = {
  pullRequestId: Id<"pullRequests">;
  repoFullName: string;
  number: number;
  installationId: number;
  teamId: string;
};

type NormalizedCommentRecord = CommentBase & {
  commentId: number;
  commentType: "issue" | "review" | "review_comment";
  body?: string;
  authorLogin?: string;
  authorId?: number;
  authorAvatarUrl?: string;
  authorAssociation?: string;
  htmlUrl?: string;
  createdAt?: number;
  updatedAt?: number;
  submittedAt?: number;
  state?: string;
  commitId?: string;
  path?: string;
  line?: number;
  originalLine?: number;
  diffHunk?: string;
  inReplyToId?: number;
  isMinimized?: boolean;
  minimizedReason?: string;
  isResolved?: boolean;
  reactions?: ReactionSummary;
  isDeleted?: boolean;
};

const reactionArg = v.object({
  totalCount: v.number(),
  plusOne: v.optional(v.number()),
  minusOne: v.optional(v.number()),
  laugh: v.optional(v.number()),
  confused: v.optional(v.number()),
  heart: v.optional(v.number()),
  hooray: v.optional(v.number()),
  rocket: v.optional(v.number()),
  eyes: v.optional(v.number()),
});

const normalizedCommentArg = v.object({
  pullRequestId: v.id("pullRequests"),
  repoFullName: v.string(),
  teamId: v.string(),
  number: v.number(),
  installationId: v.number(),
  commentId: v.number(),
  commentType: v.union(
    v.literal("issue"),
    v.literal("review"),
    v.literal("review_comment"),
  ),
  body: v.optional(v.string()),
  authorLogin: v.optional(v.string()),
  authorId: v.optional(v.number()),
  authorAvatarUrl: v.optional(v.string()),
  authorAssociation: v.optional(v.string()),
  htmlUrl: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  submittedAt: v.optional(v.number()),
  state: v.optional(v.string()),
  commitId: v.optional(v.string()),
  path: v.optional(v.string()),
  line: v.optional(v.number()),
  originalLine: v.optional(v.number()),
  diffHunk: v.optional(v.string()),
  inReplyToId: v.optional(v.number()),
  isMinimized: v.optional(v.boolean()),
  minimizedReason: v.optional(v.string()),
  isResolved: v.optional(v.boolean()),
  isDeleted: v.optional(v.boolean()),
  reactions: v.optional(reactionArg),
});

type PullRequestCommentView = {
  _id: Id<"pullRequestComments">;
  commentId: number;
  commentType: "issue" | "review" | "review_comment";
  body?: string;
  authorLogin?: string;
  authorAvatarUrl?: string;
  authorAssociation?: string;
  htmlUrl?: string;
  createdAt: number;
  updatedAt?: number;
  submittedAt?: number;
  state?: string;
  commitId?: string;
  path?: string;
  line?: number;
  originalLine?: number;
  diffHunk?: string;
  inReplyToId?: number;
  reactions?: ReactionSummary;
};

function toMillis(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = value > MILLIS_THRESHOLD ? value : value * 1000;
    return Math.round(normalized);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mapUser(user: {
  login?: string | null;
  id?: number | null;
  avatar_url?: string | null;
} | null | undefined): {
  login?: string;
  id?: number;
  avatarUrl?: string;
} {
  return {
    login: toStringOrUndefined(user?.login ?? undefined),
    id: toNumber(user?.id ?? undefined),
    avatarUrl: toStringOrUndefined(user?.avatar_url ?? undefined),
  };
}

function normalizeReactions(
  reactions: GithubReactionSummary | null | undefined,
): ReactionSummary | undefined {
  if (!reactions) return undefined;
  const totalCount = toNumber(reactions.total_count ?? undefined) ?? 0;
  return {
    totalCount,
    plusOne: toNumber(reactions["+1"] ?? undefined) ?? 0,
    minusOne: toNumber(reactions["-1"] ?? undefined) ?? 0,
    laugh: toNumber(reactions.laugh ?? undefined) ?? 0,
    confused: toNumber(reactions.confused ?? undefined) ?? 0,
    heart: toNumber(reactions.heart ?? undefined) ?? 0,
    hooray: toNumber(reactions.hooray ?? undefined) ?? 0,
    rocket: toNumber(reactions.rocket ?? undefined) ?? 0,
    eyes: toNumber(reactions.eyes ?? undefined) ?? 0,
  };
}

function splitRepoFullName(repoFullName: string):
  | { owner: string; repo: string }
  | null {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}

function normalizeIssueComment(
  comment: GithubIssueComment | undefined,
  base: CommentBase,
  overrides?: Pick<NormalizedCommentRecord, "isDeleted">,
): NormalizedCommentRecord | null {
  if (!comment || typeof comment.id !== "number") return null;
  const user = mapUser(comment.user ?? undefined);
  const createdAt = toMillis(comment.created_at) ?? Date.now();
  return {
    ...base,
    commentId: comment.id,
    commentType: "issue",
    body: toStringOrUndefined(comment.body ?? undefined),
    authorLogin: user.login,
    authorId: user.id,
    authorAvatarUrl: user.avatarUrl,
    authorAssociation: toStringOrUndefined(comment.author_association ?? undefined),
    htmlUrl: toStringOrUndefined(comment.html_url ?? undefined),
    createdAt,
    updatedAt: toMillis(comment.updated_at),
    reactions: normalizeReactions(comment.reactions),
    isDeleted: overrides?.isDeleted,
  };
}

function normalizeReviewComment(
  comment: GithubReviewComment | undefined,
  base: CommentBase,
  overrides?: Pick<NormalizedCommentRecord, "isDeleted">,
): NormalizedCommentRecord | null {
  if (!comment || typeof comment.id !== "number") return null;
  const user = mapUser(comment.user ?? undefined);
  const createdAt = toMillis(comment.created_at) ?? Date.now();
  return {
    ...base,
    commentId: comment.id,
    commentType: "review_comment",
    body: toStringOrUndefined(comment.body ?? undefined),
    authorLogin: user.login,
    authorId: user.id,
    authorAvatarUrl: user.avatarUrl,
    authorAssociation: toStringOrUndefined(comment.author_association ?? undefined),
    htmlUrl: toStringOrUndefined(comment.html_url ?? undefined),
    createdAt,
    updatedAt: toMillis(comment.updated_at),
    commitId: toStringOrUndefined(comment.commit_id ?? undefined),
    path: toStringOrUndefined(comment.path ?? undefined),
    line: toNumber(comment.line ?? undefined),
    originalLine: toNumber(comment.original_line ?? undefined),
    diffHunk: toStringOrUndefined(comment.diff_hunk ?? undefined),
    inReplyToId: toNumber(comment.in_reply_to_id ?? undefined),
    reactions: normalizeReactions(comment.reactions as GithubReactionSummary | undefined),
    isDeleted: overrides?.isDeleted,
  };
}

function normalizeReview(
  review: GithubReview | undefined,
  base: CommentBase,
): NormalizedCommentRecord | null {
  if (!review || typeof review.id !== "number") return null;
  const user = mapUser(review.user ?? undefined);
  const submittedAt = toMillis(review.submitted_at) ?? Date.now();
  const state =
    typeof review.state === "string"
      ? review.state.toLowerCase()
      : undefined;
  return {
    ...base,
    commentId: review.id,
    commentType: "review",
    body: toStringOrUndefined(review.body ?? undefined),
    authorLogin: user.login,
    authorId: user.id,
    authorAvatarUrl: user.avatarUrl,
    authorAssociation: toStringOrUndefined(review.author_association ?? undefined),
    htmlUrl: toStringOrUndefined(review.html_url ?? undefined),
    createdAt: submittedAt,
    updatedAt: submittedAt,
    submittedAt,
    state,
    commitId: toStringOrUndefined(review.commit_id ?? undefined),
    reactions: normalizeReactions(review.reactions as GithubReactionSummary | undefined),
  };
}

async function upsertNormalizedComment(
  ctx: MutationCtx,
  comment: NormalizedCommentRecord,
  timestamp: number,
): Promise<void> {
  const existing = await ctx.db
    .query("pullRequestComments")
    .withIndex("by_repo_comment", (q) =>
      q.eq("repoFullName", comment.repoFullName).eq("commentId", comment.commentId),
    )
    .first();

  const doc = {
    provider: "github" as const,
    installationId: comment.installationId,
    teamId: comment.teamId,
    pullRequestId: comment.pullRequestId,
    repoFullName: comment.repoFullName,
    number: comment.number,
    commentId: comment.commentId,
    commentType: comment.commentType,
    body: comment.body,
    authorLogin: comment.authorLogin,
    authorId: comment.authorId,
    authorAvatarUrl: comment.authorAvatarUrl,
    authorAssociation: comment.authorAssociation,
    htmlUrl: comment.htmlUrl,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    submittedAt: comment.submittedAt,
    state: comment.state,
    commitId: comment.commitId,
    path: comment.path,
    line: comment.line,
    originalLine: comment.originalLine,
    diffHunk: comment.diffHunk,
    inReplyToId: comment.inReplyToId,
    isMinimized: comment.isMinimized,
    minimizedReason: comment.minimizedReason,
    isResolved: comment.isResolved,
    isDeleted: comment.isDeleted,
    reactions: comment.reactions,
    lastSyncedAt: timestamp,
  } satisfies Partial<Doc<"pullRequestComments">> & {
    provider: "github";
    installationId: number;
    teamId: string;
    pullRequestId: Id<"pullRequests">;
    repoFullName: string;
    number: number;
    commentId: number;
    commentType: "issue" | "review" | "review_comment";
  };

  if (existing) {
    await ctx.db.patch(existing._id, doc);
  } else {
    await ctx.db.insert("pullRequestComments", doc);
  }
}

function sanitizeCommentForClient(
  comment: Doc<"pullRequestComments">,
): PullRequestCommentView {
  const createdAt =
    comment.createdAt ??
    comment.submittedAt ??
    comment.updatedAt ??
    comment._creationTime;
  return {
    _id: comment._id,
    commentId: comment.commentId,
    commentType: comment.commentType,
    body: comment.body,
    authorLogin: comment.authorLogin,
    authorAvatarUrl: comment.authorAvatarUrl,
    authorAssociation: comment.authorAssociation,
    htmlUrl: comment.htmlUrl,
    createdAt,
    updatedAt: comment.updatedAt,
    submittedAt: comment.submittedAt,
    state: comment.state,
    commitId: comment.commitId,
    path: comment.path,
    line: comment.line,
    originalLine: comment.originalLine,
    diffHunk: comment.diffHunk,
    inReplyToId: comment.inReplyToId,
    reactions: comment.reactions,
  };
}

async function fetchGithubCollection<T>({
  accessToken,
  url,
}: {
  accessToken: string;
  url: string;
}): Promise<T[]> {
  const results: T[] = [];
  let page = 1;
  for (;;) {
    const pagedUrl = `${url}${url.includes("?") ? "&" : "?"}per_page=${MAX_PER_PAGE}&page=${page}`;
    try {
      const response = await fetch(pagedUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "cmux-github-sync",
        },
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[github_pr_comments] Failed to fetch GitHub collection", {
          url: pagedUrl,
          status: response.status,
          error: errorText,
        });
        break;
      }
      const data = (await response.json()) as T[];
      results.push(...data);
      if (data.length < MAX_PER_PAGE) {
        break;
      }
      page += 1;
    } catch (error) {
      console.error("[github_pr_comments] Unexpected GitHub fetch failure", {
        url: pagedUrl,
        error,
      });
      break;
    }
  }
  return results;
}

export const syncCommentsFromGithub = internalAction({
  args: {
    teamId: v.string(),
    installationId: v.number(),
    repoFullName: v.string(),
    pullRequestNumber: v.number(),
  },
  handler: async (
    ctx,
    { teamId, installationId, repoFullName, pullRequestNumber },
  ) => {
    const pr = await ctx.runQuery(
      internal.github_prs.getPullRequestByTeamRepoNumber,
      {
        teamId,
        repoFullName,
        number: pullRequestNumber,
      },
    );
    if (!pr) {
      console.warn("[github_pr_comments] Could not locate pull request to sync comments", {
        teamId,
        repoFullName,
        pullRequestNumber,
      });
      return { ok: false as const, reason: "missing_pr" };
    }

    const repoParts = splitRepoFullName(repoFullName);
    if (!repoParts) {
      console.warn("[github_pr_comments] Invalid repo full name for sync", {
        repoFullName,
      });
      return { ok: false as const, reason: "invalid_repo" };
    }

    const accessToken = await fetchInstallationAccessToken(installationId);
    if (!accessToken) {
      console.error("[github_pr_comments] Unable to mint installation token", {
        installationId,
      });
      return { ok: false as const, reason: "token" };
    }

    const base: CommentBase = {
      pullRequestId: pr._id,
      repoFullName,
      number: pullRequestNumber,
      installationId: pr.installationId,
      teamId: pr.teamId,
    };

    const issueComments = await fetchGithubCollection<GithubIssueComment>({
      accessToken,
      url: `${GITHUB_API_BASE}/repos/${repoParts.owner}/${repoParts.repo}/issues/${pullRequestNumber}/comments`,
    });
    const reviewComments = await fetchGithubCollection<GithubReviewComment>({
      accessToken,
      url: `${GITHUB_API_BASE}/repos/${repoParts.owner}/${repoParts.repo}/pulls/${pullRequestNumber}/comments`,
    });
    const reviews = await fetchGithubCollection<GithubReview>({
      accessToken,
      url: `${GITHUB_API_BASE}/repos/${repoParts.owner}/${repoParts.repo}/pulls/${pullRequestNumber}/reviews`,
    });

    const normalized: NormalizedCommentRecord[] = [];
    for (const comment of issueComments) {
      const record = normalizeIssueComment(comment, base);
      if (record) normalized.push(record);
    }
    for (const comment of reviewComments) {
      const record = normalizeReviewComment(comment, base);
      if (record) normalized.push(record);
    }
    for (const review of reviews) {
      const record = normalizeReview(review, base);
      if (record) normalized.push(record);
    }

    const commentsSyncedAt = Date.now();
    await ctx.runMutation(internal.github_pr_comments.persistSyncedComments, {
      pullRequestId: pr._id,
      comments: normalized,
      commentsSyncedAt,
    });

    console.log("[github_pr_comments] Synced GitHub comments", {
      repoFullName,
      pullRequestNumber,
      total: normalized.length,
    });

    return { ok: true as const, syncedCount: normalized.length };
  },
});

export const persistSyncedComments = internalMutation({
  args: {
    pullRequestId: v.id("pullRequests"),
    comments: v.array(normalizedCommentArg),
    commentsSyncedAt: v.number(),
  },
  handler: async (ctx, { pullRequestId, comments, commentsSyncedAt }) => {
    const pr = await ctx.db.get(pullRequestId);
    if (!pr) {
      console.warn("[github_pr_comments] Skipping comment persistence for missing PR", {
        pullRequestId,
      });
      return { ok: false as const };
    }

    const now = commentsSyncedAt;
    const keepIds = new Set<number>();
    for (const comment of comments) {
      keepIds.add(comment.commentId);
      await upsertNormalizedComment(
        ctx,
        comment as NormalizedCommentRecord,
        now,
      );
    }

    const existing = await ctx.db
      .query("pullRequestComments")
      .withIndex("by_pull_request", (q) => q.eq("pullRequestId", pullRequestId))
      .collect();

    for (const row of existing) {
      if (keepIds.has(row.commentId)) continue;
      if (row.isDeleted) continue;
      await ctx.db.patch(row._id, {
        isDeleted: true,
        lastSyncedAt: now,
      });
    }

    await ctx.db.patch(pullRequestId, { commentsSyncedAt });
    return { ok: true as const, updated: comments.length };
  },
});

export const upsertIssueCommentFromWebhook = internalMutation({
  args: {
    installationId: v.number(),
    repoFullName: v.string(),
    teamId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, { installationId, repoFullName, teamId, payload }) => {
    const body = payload as IssueCommentEvent;
    const issue = body.issue;
    if (!issue?.pull_request) {
      return { ok: false as const, reason: "not_pr" };
    }
    const prNumber = Number(issue.number ?? 0);
    if (!prNumber) {
      return { ok: false as const, reason: "invalid_number" };
    }
    const pr = await ctx.db
      .query("pullRequests")
      .withIndex("by_team_repo_number", (q) =>
        q.eq("teamId", teamId).eq("repoFullName", repoFullName).eq("number", prNumber),
      )
      .first();
    if (!pr) {
      console.warn("[github_pr_comments] Issue comment received for missing PR", {
        repoFullName,
        prNumber,
      });
      return { ok: false as const, reason: "missing_pr" };
    }
    const base: CommentBase = {
      pullRequestId: pr._id,
      repoFullName,
      number: prNumber,
      installationId,
      teamId,
    };
    const normalized = normalizeIssueComment(body.comment, base, {
      isDeleted: body.action === "deleted",
    });
    if (!normalized) {
      return { ok: false as const, reason: "invalid_comment" };
    }
    await upsertNormalizedComment(ctx, normalized, Date.now());
    return { ok: true as const };
  },
});

export const upsertReviewCommentFromWebhook = internalMutation({
  args: {
    installationId: v.number(),
    repoFullName: v.string(),
    teamId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, { installationId, repoFullName, teamId, payload }) => {
    const body = payload as PullRequestReviewCommentEvent;
    const prNumber = Number(body.pull_request?.number ?? 0);
    if (!prNumber) {
      return { ok: false as const, reason: "invalid_number" };
    }
    const pr = await ctx.db
      .query("pullRequests")
      .withIndex("by_team_repo_number", (q) =>
        q.eq("teamId", teamId).eq("repoFullName", repoFullName).eq("number", prNumber),
      )
      .first();
    if (!pr) {
      console.warn("[github_pr_comments] Review comment received for missing PR", {
        repoFullName,
        prNumber,
      });
      return { ok: false as const, reason: "missing_pr" };
    }
    const base: CommentBase = {
      pullRequestId: pr._id,
      repoFullName,
      number: prNumber,
      installationId,
      teamId,
    };
    const normalized = normalizeReviewComment(body.comment, base, {
      isDeleted: body.action === "deleted",
    });
    if (!normalized) {
      return { ok: false as const, reason: "invalid_comment" };
    }
    await upsertNormalizedComment(ctx, normalized, Date.now());
    return { ok: true as const };
  },
});

export const upsertReviewFromWebhook = internalMutation({
  args: {
    installationId: v.number(),
    repoFullName: v.string(),
    teamId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, { installationId, repoFullName, teamId, payload }) => {
    const body = payload as PullRequestReviewEvent;
    const prNumber = Number(body.pull_request?.number ?? 0);
    if (!prNumber) {
      return { ok: false as const, reason: "invalid_number" };
    }
    const pr = await ctx.db
      .query("pullRequests")
      .withIndex("by_team_repo_number", (q) =>
        q.eq("teamId", teamId).eq("repoFullName", repoFullName).eq("number", prNumber),
      )
      .first();
    if (!pr) {
      console.warn("[github_pr_comments] Review webhook received for missing PR", {
        repoFullName,
        prNumber,
      });
      return { ok: false as const, reason: "missing_pr" };
    }
    const base: CommentBase = {
      pullRequestId: pr._id,
      repoFullName,
      number: prNumber,
      installationId,
      teamId,
    };
    const normalized = normalizeReview(body.review, base);
    if (!normalized) {
      return { ok: false as const, reason: "invalid_review" };
    }
    await upsertNormalizedComment(ctx, normalized, Date.now());
    return { ok: true as const };
  },
});

export const ensureSynced = authMutation({
  args: {
    teamSlugOrId: v.string(),
    repoFullName: v.string(),
    number: v.number(),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { teamSlugOrId, repoFullName, number, force }) => {
    const teamId = await getTeamId(ctx, teamSlugOrId);
    const pr = await ctx.db
      .query("pullRequests")
      .withIndex("by_team_repo_number", (q) =>
        q.eq("teamId", teamId).eq("repoFullName", repoFullName).eq("number", number),
      )
      .first();
    if (!pr) {
      return { ok: false as const, reason: "missing_pr" };
    }
    const now = Date.now();
    const stale =
      force === true ||
      typeof pr.commentsSyncedAt !== "number" ||
      now - pr.commentsSyncedAt > COMMENT_SYNC_TTL_MS;
    if (!stale) {
      return { ok: true as const, scheduled: false };
    }
    await ctx.scheduler.runAfter(0, internal.github_pr_comments.syncCommentsFromGithub, {
      teamId,
      installationId: pr.installationId,
      repoFullName,
      pullRequestNumber: number,
    });
    return { ok: true as const, scheduled: true };
  },
});

export const listForPullRequest = authQuery({
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
        q.eq("teamId", teamId).eq("repoFullName", repoFullName).eq("number", number),
      )
      .first();
    if (!pr) {
      return {
        comments: [] as PullRequestCommentView[],
        commentsSyncedAt: null as number | null,
      };
    }
    const rows = await ctx.db
      .query("pullRequestComments")
      .withIndex("by_pull_request", (q) => q.eq("pullRequestId", pr._id))
      .collect();
    const filtered = rows
      .filter((row) => !(row.isDeleted ?? false))
      .sort((a, b) => {
        const aTs =
          a.createdAt ?? a.submittedAt ?? a.updatedAt ?? a._creationTime;
        const bTs =
          b.createdAt ?? b.submittedAt ?? b.updatedAt ?? b._creationTime;
        return aTs - bTs;
      })
      .map(sanitizeCommentForClient);
    return {
      comments: filtered,
      commentsSyncedAt: pr.commentsSyncedAt ?? null,
    };
  },
});

export const addPrReaction = internalAction({
  args: {
    installationId: v.number(),
    repoFullName: v.string(),
    prNumber: v.number(),
    content: v.literal("eyes"),
  },
  handler: async (
    _ctx,
    { installationId, repoFullName, prNumber, content },
  ) => {
    try {
      const accessToken = await fetchInstallationAccessToken(installationId);
      if (!accessToken) {
        console.error(
          "[github_pr_comments] Failed to get access token for installation",
          { installationId },
        );
        return { ok: false, error: "Failed to get access token" };
      }

      const response = await fetch(
        `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/reactions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "cmux-github-bot",
          },
          body: JSON.stringify({ content }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[github_pr_comments] Failed to add reaction", {
          installationId,
          repoFullName,
          prNumber,
          status: response.status,
          error: errorText,
        });
        return {
          ok: false,
          error: `GitHub API error: ${response.status}`,
        };
      }

      const data = await response.json();
      console.log("[github_pr_comments] Successfully added reaction", {
        installationId,
        repoFullName,
        prNumber,
        reactionId: data.id,
      });

      return { ok: true, reactionId: data.id };
    } catch (error) {
      console.error("[github_pr_comments] Unexpected error adding reaction", {
        installationId,
        repoFullName,
        prNumber,
        error,
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
