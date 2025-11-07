import { useQuery } from "convex/react";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { ExternalLink, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import ReactMarkdown from "react-markdown";

type PullRequestCommentsProps = {
  pullRequestId: Id<"pullRequests">;
};

const REACTION_EMOJI_MAP: Record<string, string> = {
  "+1": "👍",
  "-1": "👎",
  laugh: "😄",
  confused: "😕",
  heart: "❤️",
  hooray: "🎉",
  rocket: "🚀",
  eyes: "👀",
};

export function PullRequestComments({
  pullRequestId,
}: PullRequestCommentsProps) {
  const commentsWithReactions = useQuery(
    api.github_pr_comment_queries.getCommentsWithReactions,
    { pullRequestId }
  );

  if (commentsWithReactions === undefined) {
    return (
      <div className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400">
        Loading comments...
      </div>
    );
  }

  if (commentsWithReactions.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400 flex items-center gap-2">
        <MessageSquare className="w-4 h-4" />
        No comments yet
      </div>
    );
  }

  // Sort comments by creation time
  const sortedComments = [...commentsWithReactions].sort(
    (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
  );

  return (
    <div className="border-t border-neutral-200 dark:border-neutral-800">
      <div className="px-4 py-2 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Comments ({commentsWithReactions.length})
        </h2>
      </div>
      <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {sortedComments.map((comment) => (
          <div key={comment._id} className="px-4 py-3">
            <div className="flex items-start gap-3">
              {comment.authorAvatarUrl && (
                <img
                  src={comment.authorAvatarUrl}
                  alt={comment.authorLogin || "User"}
                  className="w-8 h-8 rounded-full shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-sm text-neutral-900 dark:text-white">
                    {comment.authorLogin || "Unknown"}
                  </span>
                  {comment.commentType === "review" && comment.reviewState && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        comment.reviewState === "approved"
                          ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                          : comment.reviewState === "changes_requested"
                            ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                            : "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-400"
                      }`}
                    >
                      {comment.reviewState === "approved"
                        ? "Approved"
                        : comment.reviewState === "changes_requested"
                          ? "Changes requested"
                          : comment.reviewState === "commented"
                            ? "Commented"
                            : comment.reviewState}
                    </span>
                  )}
                  {comment.commentType === "review_comment" && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                      Code review
                    </span>
                  )}
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    {comment.createdAt
                      ? formatDistanceToNow(new Date(comment.createdAt), {
                          addSuffix: true,
                        })
                      : ""}
                  </span>
                  {comment.htmlUrl && (
                    <a
                      href={comment.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                      aria-label="View on GitHub"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {comment.commentType === "review_comment" && comment.path && (
                  <div className="mb-2 text-xs font-mono text-neutral-600 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-2 py-1 rounded inline-block">
                    {comment.path}
                    {comment.line && `:${comment.line}`}
                  </div>
                )}

                {comment.body && (
                  <div className="text-sm text-neutral-700 dark:text-neutral-300 prose prose-sm dark:prose-invert prose-neutral max-w-none">
                    <ReactMarkdown>{comment.body}</ReactMarkdown>
                  </div>
                )}

                {comment.reactions && comment.reactions.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {comment.reactions.map((reaction) => (
                      <button
                        key={reaction.content}
                        className="flex items-center gap-1 px-2 py-1 text-xs bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-full border border-neutral-200 dark:border-neutral-700 transition-colors"
                        title={reaction.users
                          .map((u) => u.login)
                          .filter(Boolean)
                          .join(", ")}
                      >
                        <span>{REACTION_EMOJI_MAP[reaction.content] || reaction.content}</span>
                        <span className="text-neutral-600 dark:text-neutral-400">
                          {reaction.count}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
