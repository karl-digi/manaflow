import type { Doc } from "@cmux/convex/dataModel";
import { api } from "@cmux/convex/api";
import { useAction, useQuery as useConvexQuery } from "convex/react";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, MessageSquareText, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type PullRequestCommentDoc = Doc<"pullRequestComments">;

type PullRequestCommentsSectionProps = {
  teamSlugOrId: string;
  repoFullName: string;
  prNumber: number;
};

const REACTION_EMOJI: Record<
  "plusOne" | "minusOne" | "laugh" | "hooray" | "confused" | "heart" | "rocket" | "eyes",
  string
> = {
  plusOne: "👍",
  minusOne: "👎",
  laugh: "😄",
  hooray: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
};

function useAutoSync({
  teamSlugOrId,
  repoFullName,
  prNumber,
  onSync,
}: {
  teamSlugOrId: string;
  repoFullName: string;
  prNumber: number;
  onSync: () => Promise<void>;
}) {
  const syncKey = `${teamSlugOrId}:${repoFullName}:${prNumber}`;
  const lastSyncKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastSyncKeyRef.current === syncKey) {
      return;
    }
    lastSyncKeyRef.current = syncKey;
    void onSync();
  }, [syncKey, onSync]);
}

function CommentBody({ body }: { body?: string }) {
  if (!body || body.trim().length === 0) {
    return (
      <p className="text-xs text-neutral-500 dark:text-neutral-400 italic">
        Comment body unavailable
      </p>
    );
  }
  return (
    <div
      className="prose prose-neutral dark:prose-invert prose-sm max-w-none
      prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5
      prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:bg-neutral-200 dark:prose-code:bg-neutral-800
      prose-code:text-[12px] prose-pre:bg-neutral-900 dark:prose-pre:bg-neutral-900 prose-pre:text-white prose-pre:rounded-md"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {body}
      </ReactMarkdown>
    </div>
  );
}

function CommentReactions({
  reactions,
}: {
  reactions?: PullRequestCommentDoc["reactions"];
}) {
  const entries = useMemo(() => {
    if (!reactions) return [];
    return (Object.entries(REACTION_EMOJI) as Array<[keyof typeof REACTION_EMOJI, string]>)
      .map(([key, emoji]) => {
        const count = reactions[key];
        if (!count || count <= 0) {
          return null;
        }
        return { key, emoji, count };
      })
      .filter(
        (reaction): reaction is { key: keyof typeof REACTION_EMOJI; emoji: string; count: number } =>
          reaction !== null,
      );
  }, [reactions]);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {entries.map((entry) => (
        <span
          key={entry.key}
          className="inline-flex items-center gap-1 rounded-full border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-300 bg-white dark:bg-neutral-900"
        >
          <span>{entry.emoji}</span>
          <span className="font-medium">{entry.count}</span>
        </span>
      ))}
    </div>
  );
}

function CommentMeta({ comment }: { comment: PullRequestCommentDoc }) {
  const createdAt = comment.createdAt ?? comment.updatedAt ?? Date.now();
  const relative = formatDistanceToNow(createdAt, { addSuffix: true });
  const pathLabel = comment.path ? comment.path.split("/").pop() : null;
  const lineNumber = comment.startLine ?? comment.line ?? comment.originalLine;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
      <span>{relative}</span>
      <span>•</span>
      <span className="uppercase tracking-tight font-semibold text-[10px] px-1.5 py-0.5 rounded bg-neutral-200/60 dark:bg-neutral-800/80 text-neutral-700 dark:text-neutral-200">
        {comment.commentType === "review" ? "Review" : "Comment"}
      </span>
      {comment.path ? (
        <>
          <span>•</span>
          <span className="font-mono text-[10px]">
            {pathLabel ?? comment.path}
            {typeof lineNumber === "number" ? `:${lineNumber}` : ""}
          </span>
        </>
      ) : null}
      {comment.permalinkUrl ? (
        <>
          <span>•</span>
          <a
            href={comment.permalinkUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            View on GitHub
          </a>
        </>
      ) : null}
    </div>
  );
}

function CommentCard({
  comment,
}: {
  comment: PullRequestCommentDoc;
}) {
  const isReply = typeof comment.inReplyToId === "number";

  return (
    <div
      className={clsx(
        "rounded-lg border border-neutral-200/80 dark:border-neutral-800/80 bg-white dark:bg-neutral-900/70 px-4 py-3",
        isReply && "ml-7 border-l-4 border-l-blue-200 dark:border-l-blue-500/60",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center text-xs font-semibold text-neutral-600 dark:text-neutral-200 overflow-hidden">
            {comment.authorAvatarUrl ? (
              <img
                src={comment.authorAvatarUrl}
                alt={comment.authorLogin ?? "GitHub user"}
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              (comment.authorLogin ?? "?").slice(0, 2).toUpperCase()
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
              {comment.authorLogin ?? "GitHub user"}
            </span>
          </div>
          <CommentMeta comment={comment} />
          <div className="mt-2 text-sm text-neutral-800 dark:text-neutral-200 break-words">
            <CommentBody body={comment.body} />
          </div>
          <CommentReactions reactions={comment.reactions} />
        </div>
      </div>
    </div>
  );
}

export function PullRequestCommentsSection({
  teamSlugOrId,
  repoFullName,
  prNumber,
}: PullRequestCommentsSectionProps) {
  const comments = useConvexQuery(api.github_pr_comments.listForPullRequest, {
    teamSlugOrId,
    repoFullName,
    number: prNumber,
  });
  const syncComments = useAction(api.github_pr_comments.syncForPullRequest);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const syncInFlightRef = useRef(false);

  const handleSync = useCallback(async () => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    setIsSyncing(true);
    try {
      await syncComments({
        teamSlugOrId,
        repoFullName,
        number: prNumber,
      });
      setLastSyncedAt(Date.now());
    } catch (error) {
      console.error("[pull-request-comments] Failed to sync comments", {
        error,
      });
      const message =
        error instanceof Error ? error.message : "Unknown sync failure";
      toast.error(`Failed to sync comments: ${message}`);
    } finally {
      syncInFlightRef.current = false;
      setIsSyncing(false);
    }
  }, [prNumber, repoFullName, syncComments, teamSlugOrId]);

  useAutoSync({
    teamSlugOrId,
    repoFullName,
    prNumber,
    onSync: handleSync,
  });

  const headerDescription =
    comments && comments.length > 0
      ? `${comments.length} comment${comments.length === 1 ? "" : "s"}`
      : "No comments yet";

  return (
    <div className="border-t border-neutral-200/80 dark:border-neutral-800/80">
      <div className="flex items-center justify-between px-4 py-3 bg-neutral-50 dark:bg-neutral-900/80 border-b border-neutral-200 dark:border-neutral-800">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquareText className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Comments
            </h2>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            {headerDescription}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastSyncedAt ? (
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
              Updated {formatDistanceToNow(lastSyncedAt, { addSuffix: true })}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={isSyncing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSyncing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Syncing…
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5 opacity-70" />
                Sync comments
              </>
            )}
          </button>
        </div>
      </div>
      <div className="px-4 py-4 bg-white dark:bg-neutral-950">
        {comments === undefined ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400">
            Loading existing comments…
          </div>
        ) : comments.length === 0 ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400">
            We haven’t pulled any GitHub comments for this PR yet. Once someone comments,
            refresh to see the thread here.
          </div>
        ) : (
          <div className="space-y-4">
            {comments.map((comment) => (
              <CommentCard key={comment._id} comment={comment} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
