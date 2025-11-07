import { fetchInstallationAccessToken } from "../_shared/githubApp";
import { getTeamId } from "../_shared/team";
import { api, internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { AuthenticationRequired, authQuery } from "./users/utils";
import { ConvexError, v } from "convex/values";

type CommentType = "issue" | "review";

type ReactionSummary = {
  plusOne?: number;
  minusOne?: number;
  laugh?: number;
  hooray?: number;
  confused?: number;
  heart?: number;
  rocket?: number;
  eyes?: number;
  totalCount?: number;
};

type GitHubUser = {
  login?: string | null;
  id?: number | null;
  avatar_url?: string | null;
};

type GitHubReactions = {
  "+1"?: number;
  "-1"?: number;
  laugh?: number;
  hooray?: number;
  confused?: number;
  heart?: number;
  rocket?: number;
  eyes?: number;
  total_count?: number;
} | null;

type GitHubIssueComment = {
  id?: number | null;
  node_id?: string | null;
  body?: string | null;
  html_url?: string | null;
  url?: string | null;
  user?: GitHubUser | null;
  created_at?: string | null;
  updated_at?: string | null;
  author_association?: string | null;
  reactions?: GitHubReactions;
};

type GitHubReviewComment = {
  id?: number | null;
  node_id?: string | null;
  body?: string | null;
  html_url?: string | null;
  url?: string | null;
  user?: GitHubUser | null;
  created_at?: string | null;
  updated_at?: string | null;
  author_association?: string | null;
  diff_hunk?: string | null;
  path?: string | null;
  commit_id?: string | null;
  original_commit_id?: string | null;
  pull_request_review_id?: number | null;
  in_reply_to_id?: number | null;
  position?: number | null;
  original_position?: number | null;
  start_line?: number | null;
  line?: number | null;
  original_line?: number | null;
  side?: string | null;
  start_side?: string | null;
  subject_type?: string | null;
  state?: string | null;
  reactions?: GitHubReactions;
};

type NormalizedPullRequestComment = {
  commentType: CommentType;
  providerCommentId: number;
  nodeId?: string;
  body?: string;
  authorLogin?: string;
  authorId?: number;
  authorAvatarUrl?: string;
  authorAssociation?: string;
  url?: string;
  permalinkUrl?: string;
  createdAt?: number;
  updatedAt?: number;
  lastSyncedAt?: number;
  inReplyToId?: number;
  path?: string;
  diffHunk?: string;
  position?: number;
  originalPosition?: number;
  commitId?: string;
  originalCommitId?: string;
  pullRequestReviewId?: number;
  startLine?: number;
  line?: number;
  originalLine?: number;
  side?: string;
  startSide?: string;
  subjectType?: string;
  state?: string;
  reactions?: ReactionSummary;
  isMinimized?: boolean;
  minimizedReason?: string;
};

type SyncResult = {
  synced: number;
  issueComments: number;
  reviewComments: number;
};

const reactionSummaryValidator = v.object({
  plusOne: v.optional(v.number()),
  minusOne: v.optional(v.number()),
  laugh: v.optional(v.number()),
  hooray: v.optional(v.number()),
  confused: v.optional(v.number()),
  heart: v.optional(v.number()),
  rocket: v.optional(v.number()),
  eyes: v.optional(v.number()),
  totalCount: v.optional(v.number()),
});

const commentTypeValidator = v.union(v.literal("issue"), v.literal("review"));

const normalizedCommentValidator = v.object({
  commentType: commentTypeValidator,
  providerCommentId: v.number(),
  nodeId: v.optional(v.string()),
  body: v.optional(v.string()),
  authorLogin: v.optional(v.string()),
  authorId: v.optional(v.number()),
  authorAvatarUrl: v.optional(v.string()),
  authorAssociation: v.optional(v.string()),
  url: v.optional(v.string()),
  permalinkUrl: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  lastSyncedAt: v.optional(v.number()),
  inReplyToId: v.optional(v.number()),
  path: v.optional(v.string()),
  diffHunk: v.optional(v.string()),
  position: v.optional(v.number()),
  originalPosition: v.optional(v.number()),
  commitId: v.optional(v.string()),
  originalCommitId: v.optional(v.string()),
  pullRequestReviewId: v.optional(v.number()),
  startLine: v.optional(v.number()),
  line: v.optional(v.number()),
  originalLine: v.optional(v.number()),
  side: v.optional(v.string()),
  startSide: v.optional(v.string()),
  subjectType: v.optional(v.string()),
  state: v.optional(v.string()),
  reactions: v.optional(reactionSummaryValidator),
  isMinimized: v.optional(v.boolean()),
  minimizedReason: v.optional(v.string()),
});

function buildCommentKey(type: CommentType, id: number): string {
  return `${type}:${id}`;
}

function normalizeTimestamp(value: string | number | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function mapReactions(reactions?: GitHubReactions): ReactionSummary | undefined {
  if (!reactions) return undefined;
  return {
    plusOne: reactions["+1"] ?? undefined,
    minusOne: reactions["-1"] ?? undefined,
    laugh: reactions.laugh ?? undefined,
    hooray: reactions.hooray ?? undefined,
    confused: reactions.confused ?? undefined,
    heart: reactions.heart ?? undefined,
    rocket: reactions.rocket ?? undefined,
    eyes: reactions.eyes ?? undefined,
    totalCount: reactions.total_count ?? undefined,
  };
}

function ensureCommentId(rawId: unknown): number | null {
  if (typeof rawId === "number" && Number.isFinite(rawId)) {
    return rawId;
  }
  return null;
}

function normalizeIssueComment(
  comment: GitHubIssueComment | undefined,
): NormalizedPullRequestComment | null {
  if (!comment) return null;
  const providerCommentId = ensureCommentId(comment.id);
  if (!providerCommentId) return null;
  const createdAt =
    normalizeTimestamp(comment.created_at) ??
    normalizeTimestamp(comment.updated_at) ??
    Date.now();
  const updatedAt =
    normalizeTimestamp(comment.updated_at) ?? createdAt;
  return {
    commentType: "issue",
    providerCommentId,
    nodeId: typeof comment.node_id === "string" ? comment.node_id : undefined,
    body: typeof comment.body === "string" ? comment.body : undefined,
    authorLogin: comment.user?.login ?? undefined,
    authorId:
      typeof comment.user?.id === "number" ? comment.user?.id : undefined,
    authorAvatarUrl: comment.user?.avatar_url ?? undefined,
    authorAssociation: comment.author_association ?? undefined,
    url: comment.url ?? undefined,
    permalinkUrl: comment.html_url ?? undefined,
    createdAt,
    updatedAt,
    lastSyncedAt: Date.now(),
    reactions: mapReactions(comment.reactions),
  };
}

function normalizeReviewComment(
  comment: GitHubReviewComment | undefined,
): NormalizedPullRequestComment | null {
  if (!comment) return null;
  const providerCommentId = ensureCommentId(comment.id);
  if (!providerCommentId) return null;
  const createdAt =
    normalizeTimestamp(comment.created_at) ??
    normalizeTimestamp(comment.updated_at) ??
    Date.now();
  const updatedAt =
    normalizeTimestamp(comment.updated_at) ?? createdAt;
  const line =
    typeof comment.line === "number"
      ? comment.line
      : typeof comment.original_line === "number"
        ? comment.original_line
        : undefined;
  return {
    commentType: "review",
    providerCommentId,
    nodeId: typeof comment.node_id === "string" ? comment.node_id : undefined,
    body: typeof comment.body === "string" ? comment.body : undefined,
    authorLogin: comment.user?.login ?? undefined,
    authorId:
      typeof comment.user?.id === "number" ? comment.user?.id : undefined,
    authorAvatarUrl: comment.user?.avatar_url ?? undefined,
    authorAssociation: comment.author_association ?? undefined,
    url: comment.url ?? undefined,
    permalinkUrl: comment.html_url ?? undefined,
    createdAt,
    updatedAt,
    lastSyncedAt: Date.now(),
    diffHunk: comment.diff_hunk ?? undefined,
    path: comment.path ?? undefined,
    commitId: comment.commit_id ?? undefined,
    originalCommitId: comment.original_commit_id ?? undefined,
    pullRequestReviewId:
      typeof comment.pull_request_review_id === "number"
        ? comment.pull_request_review_id
        : undefined,
    inReplyToId:
      typeof comment.in_reply_to_id === "number"
        ? comment.in_reply_to_id
        : undefined,
    position:
      typeof comment.position === "number" ? comment.position : undefined,
    originalPosition:
      typeof comment.original_position === "number"
        ? comment.original_position
        : undefined,
    startLine:
      typeof comment.start_line === "number" ? comment.start_line : undefined,
    line,
    originalLine:
      typeof comment.original_line === "number"
        ? comment.original_line
        : undefined,
    side: comment.side ?? undefined,
    startSide: comment.start_side ?? undefined,
    subjectType: comment.subject_type ?? undefined,
    state: comment.state ?? undefined,
    reactions: mapReactions(comment.reactions),
  };
}

async function fetchPaginatedCollection<T>({
  baseUrl,
  accessToken,
}: {
  baseUrl: string;
  accessToken: string;
}): Promise<T[]> {
  const perPage = 100;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "cmux",
  };
  const items: T[] = [];
  for (let page = 1; page < 1000; page++) {
    const url =
      baseUrl.includes("?")
        ? `${baseUrl}&per_page=${perPage}&page=${page}`
        : `${baseUrl}?per_page=${perPage}&page=${page}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const text = await response.text();
      throw new ConvexError(
        `[github_pr_comments] Failed to fetch ${baseUrl} (status ${response.status}): ${text}`,
      );
    }
    const pageItems = (await response.json()) as T[];
    if (!Array.isArray(pageItems) || pageItems.length === 0) {
      break;
    }
    items.push(...pageItems);
    if (pageItems.length < perPage) {
      break;
    }
  }
  return items;
}

function splitRepoFullName(repoFullName: string): { owner: string; repo: string } {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new ConvexError(
      `[github_pr_comments] Invalid repo full name "${repoFullName}"`,
    );
  }
  return { owner, repo };
}

async function fetchIssueCommentsFromGithub({
  accessToken,
  repoFullName,
  number,
}: {
  accessToken: string;
  repoFullName: string;
  number: number;
}): Promise<GitHubIssueComment[]> {
  const { owner, repo } = splitRepoFullName(repoFullName);
  const baseUrl = `https://api.github.com/repos/${encodeURIComponent(
    owner,
  )}/${encodeURIComponent(repo)}/issues/${number}/comments`;
  return fetchPaginatedCollection<GitHubIssueComment>({
    baseUrl,
    accessToken,
  });
}

async function fetchReviewCommentsFromGithub({
  accessToken,
  repoFullName,
  number,
}: {
  accessToken: string;
  repoFullName: string;
  number: number;
}): Promise<GitHubReviewComment[]> {
  const { owner, repo } = splitRepoFullName(repoFullName);
  const baseUrl = `https://api.github.com/repos/${encodeURIComponent(
    owner,
  )}/${encodeURIComponent(repo)}/pulls/${number}/comments`;
  return fetchPaginatedCollection<GitHubReviewComment>({
    baseUrl,
    accessToken,
  });
}

async function resolvePullRequestDoc(
  ctx: MutationCtx,
  {
    teamId,
    repoFullName,
    pullRequestNumber,
  }: {
    teamId: string;
    repoFullName: string;
    pullRequestNumber: number;
  },
): Promise<Doc<"pullRequests"> | null> {
  return ctx.db
    .query("pullRequests")
    .withIndex("by_team_repo_number", (q) =>
      q.eq("teamId", teamId).eq("repoFullName", repoFullName).eq("number", pullRequestNumber),
    )
    .first();
}

async function upsertCommentDoc(
  ctx: MutationCtx,
  {
    teamId,
    repoFullName,
    pullRequestNumber,
    installationId,
    pullRequestId,
    comment,
  }: {
    teamId: string;
    repoFullName: string;
    pullRequestNumber: number;
    installationId: number;
    pullRequestId?: Id<"pullRequests">;
    comment: NormalizedPullRequestComment;
  },
): Promise<void> {
  const commentKey = buildCommentKey(
    comment.commentType,
    comment.providerCommentId,
  );
  const existing = await ctx.db
    .query("pullRequestComments")
    .withIndex("by_comment_key", (q) =>
      q
        .eq("teamId", teamId)
        .eq("repoFullName", repoFullName)
        .eq("pullRequestNumber", pullRequestNumber)
        .eq("commentKey", commentKey),
    )
    .first();

  const baseRecord = {
    installationId,
    commentKey,
    providerCommentId: comment.providerCommentId,
    commentType: comment.commentType,
    nodeId: comment.nodeId,
    body: comment.body,
    authorLogin: comment.authorLogin,
    authorId: comment.authorId,
    authorAvatarUrl: comment.authorAvatarUrl,
    authorAssociation: comment.authorAssociation,
    url: comment.url,
    permalinkUrl: comment.permalinkUrl,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    lastSyncedAt: comment.lastSyncedAt ?? Date.now(),
    inReplyToId: comment.inReplyToId,
    path: comment.path,
    diffHunk: comment.diffHunk,
    position: comment.position,
    originalPosition: comment.originalPosition,
    commitId: comment.commitId,
    originalCommitId: comment.originalCommitId,
    pullRequestReviewId: comment.pullRequestReviewId,
    startLine: comment.startLine,
    line: comment.line,
    originalLine: comment.originalLine,
    side: comment.side,
    startSide: comment.startSide,
    subjectType: comment.subjectType,
    state: comment.state,
    reactions: comment.reactions,
    isMinimized: comment.isMinimized,
    minimizedReason: comment.minimizedReason,
    isDeleted: false,
  };

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...baseRecord,
      pullRequestId: pullRequestId ?? existing.pullRequestId,
    });
  } else {
    await ctx.db.insert("pullRequestComments", {
      teamId,
      repoFullName,
      pullRequestNumber,
      pullRequestId,
      ...baseRecord,
    });
  }
}

async function markDeleted(
  ctx: MutationCtx,
  {
    teamId,
    repoFullName,
    pullRequestNumber,
    commentType,
    providerCommentId,
  }: {
    teamId: string;
    repoFullName: string;
    pullRequestNumber: number;
    commentType: CommentType;
    providerCommentId: number;
  },
): Promise<void> {
  const commentKey = buildCommentKey(commentType, providerCommentId);
  const existing = await ctx.db
    .query("pullRequestComments")
    .withIndex("by_comment_key", (q) =>
      q
        .eq("teamId", teamId)
        .eq("repoFullName", repoFullName)
        .eq("pullRequestNumber", pullRequestNumber)
        .eq("commentKey", commentKey),
    )
    .first();
  if (!existing) {
    return;
  }
  await ctx.db.patch(existing._id, {
    isDeleted: true,
    body: "",
    lastSyncedAt: Date.now(),
  });
}

export const upsertGithubCommentFromWebhook = internalMutation({
  args: {
    teamId: v.string(),
    repoFullName: v.string(),
    pullRequestNumber: v.number(),
    installationId: v.number(),
    commentType: commentTypeValidator,
    comment: v.any(),
  },
  handler: async (
    ctx,
    {
      teamId,
      repoFullName,
      pullRequestNumber,
      installationId,
      commentType,
      comment,
    },
  ) => {
    const normalized =
      commentType === "issue"
        ? normalizeIssueComment(comment as GitHubIssueComment)
        : normalizeReviewComment(comment as GitHubReviewComment);
    if (!normalized) {
      console.warn(
        "[github_pr_comments] Skipping webhook comment without id",
        {
          repoFullName,
          pullRequestNumber,
          commentType,
        },
      );
      return { ok: false as const };
    }
    const pullRequest = await resolvePullRequestDoc(ctx, {
      teamId,
      repoFullName,
      pullRequestNumber,
    });
    await upsertCommentDoc(ctx, {
      teamId,
      repoFullName,
      pullRequestNumber,
      installationId,
      pullRequestId: pullRequest?._id,
      comment: normalized,
    });
    return { ok: true as const };
  },
});

export const deleteGithubCommentFromWebhook = internalMutation({
  args: {
    teamId: v.string(),
    repoFullName: v.string(),
    pullRequestNumber: v.number(),
    commentType: commentTypeValidator,
    providerCommentId: v.number(),
  },
  handler: async (
    ctx,
    { teamId, repoFullName, pullRequestNumber, commentType, providerCommentId },
  ) => {
    await markDeleted(ctx, {
      teamId,
      repoFullName,
      pullRequestNumber,
      commentType,
      providerCommentId,
    });
    return { ok: true as const };
  },
});

export const bulkUpsert = internalMutation({
  args: {
    teamId: v.string(),
    repoFullName: v.string(),
    pullRequestNumber: v.number(),
    installationId: v.number(),
    comments: v.array(normalizedCommentValidator),
  },
  handler: async (
    ctx,
    { teamId, repoFullName, pullRequestNumber, installationId, comments },
  ) => {
    if (!comments.length) return { updated: 0 };
    const pullRequest = await resolvePullRequestDoc(ctx, {
      teamId,
      repoFullName,
      pullRequestNumber,
    });
    for (const comment of comments) {
      await upsertCommentDoc(ctx, {
        teamId,
        repoFullName,
        pullRequestNumber,
        installationId,
        pullRequestId: pullRequest?._id,
        comment,
      });
    }
    return { updated: comments.length };
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
    const cursor = ctx.db
      .query("pullRequestComments")
      .withIndex("by_pr", (q) =>
        q.eq("teamId", teamId).eq("repoFullName", repoFullName).eq("pullRequestNumber", number),
      )
      .order("asc");
    const rows = await cursor.collect();
    return rows.filter((row) => row.isDeleted !== true);
  },
});

export const syncForPullRequest = action({
  args: {
    teamSlugOrId: v.string(),
    repoFullName: v.string(),
    number: v.number(),
  },
  handler: async (
    ctx,
    { teamSlugOrId, repoFullName, number },
  ): Promise<SyncResult> => {
    await AuthenticationRequired({ ctx });
    const pr = await ctx.runQuery(api.github_prs.getPullRequest, {
      teamSlugOrId,
      repoFullName,
      number,
    });
    if (!pr) {
      throw new ConvexError(
        `[github_pr_comments] Pull request ${repoFullName}#${number} not found`,
      );
    }
    const accessToken = await fetchInstallationAccessToken(pr.installationId);
    if (!accessToken) {
      throw new ConvexError(
        "[github_pr_comments] Unable to fetch installation access token",
      );
    }

    const [issueComments, reviewComments]: [
      GitHubIssueComment[],
      GitHubReviewComment[],
    ] = await Promise.all([
      fetchIssueCommentsFromGithub({
        accessToken,
        repoFullName: pr.repoFullName,
        number: pr.number,
      }),
      fetchReviewCommentsFromGithub({
        accessToken,
        repoFullName: pr.repoFullName,
        number: pr.number,
      }),
    ]);

    const normalized: NormalizedPullRequestComment[] = [];
    for (const comment of issueComments) {
      const mapped = normalizeIssueComment(comment);
      if (mapped) normalized.push(mapped);
    }
    for (const comment of reviewComments) {
      const mapped = normalizeReviewComment(comment);
      if (mapped) normalized.push(mapped);
    }

    if (normalized.length > 0) {
      await ctx.runMutation(internal.github_pr_comments.bulkUpsert, {
        teamId: pr.teamId,
        repoFullName: pr.repoFullName,
        pullRequestNumber: pr.number,
        installationId: pr.installationId,
        comments: normalized,
      });
    }

    return {
      synced: normalized.length,
      issueComments: issueComments.length,
      reviewComments: reviewComments.length,
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
