import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Upsert a PR comment from a GitHub webhook payload
 */
export const upsertComment = internalMutation({
  args: {
    teamId: v.string(),
    installationId: v.number(),
    repositoryId: v.optional(v.number()),
    repoFullName: v.string(),
    prNumber: v.number(),
    pullRequestId: v.string(),
    providerCommentId: v.number(),
    commentType: v.union(
      v.literal("issue_comment"),
      v.literal("review"),
      v.literal("review_comment")
    ),
    authorLogin: v.optional(v.string()),
    authorId: v.optional(v.number()),
    authorAvatarUrl: v.optional(v.string()),
    body: v.optional(v.string()),
    htmlUrl: v.optional(v.string()),
    reviewState: v.optional(
      v.union(
        v.literal("approved"),
        v.literal("changes_requested"),
        v.literal("commented"),
        v.literal("dismissed"),
        v.literal("pending")
      )
    ),
    path: v.optional(v.string()),
    line: v.optional(v.number()),
    startLine: v.optional(v.number()),
    side: v.optional(v.union(v.literal("LEFT"), v.literal("RIGHT"))),
    commitId: v.optional(v.string()),
    originalCommitId: v.optional(v.string()),
    diffHunk: v.optional(v.string()),
    inReplyToId: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Check if comment already exists
    const existing = await ctx.db
      .query("pullRequestComments")
      .withIndex("by_provider_id", (q) =>
        q.eq("providerCommentId", args.providerCommentId)
      )
      .unique();

    if (existing) {
      // Update existing comment
      await ctx.db.patch(existing._id, {
        body: args.body,
        updatedAt: args.updatedAt ?? Date.now(),
        reviewState: args.reviewState,
        authorAvatarUrl: args.authorAvatarUrl,
        htmlUrl: args.htmlUrl,
      });
      return existing._id;
    }

    // Create new comment
    const commentId = await ctx.db.insert("pullRequestComments", {
      provider: "github",
      installationId: args.installationId,
      repositoryId: args.repositoryId,
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
      pullRequestId: args.pullRequestId,
      providerCommentId: args.providerCommentId,
      commentType: args.commentType,
      teamId: args.teamId,
      authorLogin: args.authorLogin,
      authorId: args.authorId,
      authorAvatarUrl: args.authorAvatarUrl,
      body: args.body,
      htmlUrl: args.htmlUrl,
      reviewState: args.reviewState,
      path: args.path,
      line: args.line,
      startLine: args.startLine,
      side: args.side,
      commitId: args.commitId,
      originalCommitId: args.originalCommitId,
      diffHunk: args.diffHunk,
      inReplyToId: args.inReplyToId,
      createdAt: args.createdAt ?? Date.now(),
      updatedAt: args.updatedAt ?? Date.now(),
    });

    return commentId;
  },
});

/**
 * Delete a PR comment
 */
export const deleteComment = internalMutation({
  args: {
    providerCommentId: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pullRequestComments")
      .withIndex("by_provider_id", (q) =>
        q.eq("providerCommentId", args.providerCommentId)
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/**
 * Upsert a reaction from a GitHub webhook payload
 */
export const upsertReaction = internalMutation({
  args: {
    teamId: v.string(),
    installationId: v.number(),
    repositoryId: v.optional(v.number()),
    repoFullName: v.string(),
    prNumber: v.number(),
    subjectType: v.union(
      v.literal("pull_request"),
      v.literal("issue_comment"),
      v.literal("review_comment")
    ),
    subjectId: v.optional(v.string()),
    providerSubjectId: v.number(),
    providerReactionId: v.number(),
    content: v.string(),
    userId: v.optional(v.number()),
    userLogin: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Check if reaction already exists
    const existing = await ctx.db
      .query("pullRequestReactions")
      .withIndex("by_provider_id", (q) =>
        q.eq("providerReactionId", args.providerReactionId)
      )
      .unique();

    if (existing) {
      // Reaction already exists, no need to update
      return existing._id;
    }

    // Create new reaction
    const reactionId = await ctx.db.insert("pullRequestReactions", {
      provider: "github",
      installationId: args.installationId,
      repositoryId: args.repositoryId,
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
      teamId: args.teamId,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      providerSubjectId: args.providerSubjectId,
      providerReactionId: args.providerReactionId,
      content: args.content,
      userId: args.userId,
      userLogin: args.userLogin,
      createdAt: args.createdAt ?? Date.now(),
    });

    return reactionId;
  },
});

/**
 * Delete a reaction
 */
export const deleteReaction = internalMutation({
  args: {
    providerReactionId: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pullRequestReactions")
      .withIndex("by_provider_id", (q) =>
        q.eq("providerReactionId", args.providerReactionId)
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/**
 * Get PR ID from repo and number
 */
export const getPullRequestId = internalQuery({
  args: {
    teamId: v.string(),
    repoFullName: v.string(),
    prNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const pr = await ctx.db
      .query("pullRequests")
      .withIndex("by_team_repo_number", (q) =>
        q
          .eq("teamId", args.teamId)
          .eq("repoFullName", args.repoFullName)
          .eq("number", args.prNumber)
      )
      .unique();

    return pr?._id;
  },
});
