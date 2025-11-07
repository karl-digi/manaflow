import { v } from "convex/values";
import { query } from "./_generated/server";

/**
 * Get all comments for a pull request
 */
export const getCommentsByPr = query({
  args: {
    pullRequestId: v.id("pullRequests"),
  },
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("pullRequestComments")
      .withIndex("by_pr", (q) => q.eq("pullRequestId", args.pullRequestId))
      .collect();

    return comments;
  },
});

/**
 * Get reactions for a subject (PR or comment)
 */
export const getReactionsBySubject = query({
  args: {
    subjectType: v.union(
      v.literal("pull_request"),
      v.literal("issue_comment"),
      v.literal("review_comment")
    ),
    subjectId: v.string(),
  },
  handler: async (ctx, args) => {
    const reactions = await ctx.db
      .query("pullRequestReactions")
      .withIndex("by_subject", (q) =>
        q.eq("subjectType", args.subjectType).eq("subjectId", args.subjectId)
      )
      .collect();

    // Group reactions by content
    const reactionGroups = new Map<
      string,
      {
        content: string;
        count: number;
        users: Array<{ login: string | undefined; id: number | undefined }>;
      }
    >();

    for (const reaction of reactions) {
      const existing = reactionGroups.get(reaction.content);
      if (existing) {
        existing.count++;
        existing.users.push({
          login: reaction.userLogin,
          id: reaction.userId,
        });
      } else {
        reactionGroups.set(reaction.content, {
          content: reaction.content,
          count: 1,
          users: [
            {
              login: reaction.userLogin,
              id: reaction.userId,
            },
          ],
        });
      }
    }

    return Array.from(reactionGroups.values());
  },
});

/**
 * Get all reactions for a PR (including reactions on the PR and all its comments)
 */
export const getAllReactionsByPr = query({
  args: {
    teamId: v.string(),
    repoFullName: v.string(),
    prNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const reactions = await ctx.db
      .query("pullRequestReactions")
      .withIndex("by_pr", (q) =>
        q
          .eq("teamId", args.teamId)
          .eq("repoFullName", args.repoFullName)
          .eq("prNumber", args.prNumber)
      )
      .collect();

    return reactions;
  },
});

/**
 * Get comments with their reactions
 */
export const getCommentsWithReactions = query({
  args: {
    pullRequestId: v.id("pullRequests"),
  },
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("pullRequestComments")
      .withIndex("by_pr", (q) => q.eq("pullRequestId", args.pullRequestId))
      .collect();

    // Get reactions for all comments
    const commentsWithReactions = await Promise.all(
      comments.map(async (comment) => {
        // Map comment type to reaction subject type
        // Reviews are treated as issue_comments for reactions
        const subjectType =
          comment.commentType === "review"
            ? "issue_comment"
            : comment.commentType;

        const reactions = await ctx.db
          .query("pullRequestReactions")
          .withIndex("by_subject", (q) =>
            q.eq("subjectType", subjectType).eq("subjectId", comment._id)
          )
          .collect();

        // Group reactions by content
        const reactionGroups = new Map<
          string,
          {
            content: string;
            count: number;
            users: Array<{ login: string | undefined; id: number | undefined }>;
          }
        >();

        for (const reaction of reactions) {
          const existing = reactionGroups.get(reaction.content);
          if (existing) {
            existing.count++;
            existing.users.push({
              login: reaction.userLogin,
              id: reaction.userId,
            });
          } else {
            reactionGroups.set(reaction.content, {
              content: reaction.content,
              count: 1,
              users: [
                {
                  login: reaction.userLogin,
                  id: reaction.userId,
                },
              ],
            });
          }
        }

        return {
          ...comment,
          reactions: Array.from(reactionGroups.values()),
        };
      })
    );

    return commentsWithReactions;
  },
});
