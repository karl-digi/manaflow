import { FloatingPane } from "@/components/floating-pane";
import { PersistentWebView } from "@/components/persistent-webview";
import { getTaskRunPullRequestPersistKey } from "@/lib/persistent-webview-keys";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import z from "zod";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
});

type RunPullRequest = {
  repoFullName: string;
  url?: string;
  number?: number;
  state: "none" | "draft" | "open" | "merged" | "closed" | "unknown";
  isDraft?: boolean;
};

type PullRequestComment = {
  _id: string;
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
  reactions?: {
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
};

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/pr"
)({
  component: RunPullRequestPage,
  params: {
    parse: paramsSchema.parse,
    stringify: (params) => {
      return {
        taskId: params.taskId,
        runId: params.runId,
      };
    },
  },
  loader: async (opts) => {
    const { teamSlugOrId, taskId } = opts.params;
    convexQueryClient.convexClient.prewarmQuery({
      query: api.taskRuns.getByTask,
      args: {
        teamSlugOrId,
        taskId,
      },
    });

    convexQueryClient.convexClient.prewarmQuery({
      query: api.tasks.getById,
      args: { teamSlugOrId, id: taskId },
    });
  },
});

function RunPullRequestPage() {
  const { taskId, teamSlugOrId, runId } = Route.useParams();

  const task = useQuery(api.tasks.getById, {
    teamSlugOrId,
    id: taskId,
  });

  const taskRuns = useQuery(api.taskRuns.getByTask, {
    teamSlugOrId,
    taskId,
  });

  // Get the specific run from the URL parameter
  const selectedRun = useMemo(() => {
    return taskRuns?.find((run) => run._id === runId);
  }, [runId, taskRuns]);

  const pullRequests = useMemo<RunPullRequest[]>(
    () => selectedRun?.pullRequests ?? [],
    [selectedRun?.pullRequests]
  );
  const [activeRepo, setActiveRepo] = useState<string | null>(
    () => pullRequests[0]?.repoFullName ?? null
  );

  useEffect(() => {
    if (pullRequests.length === 0) {
      if (activeRepo !== null) {
        setActiveRepo(null);
      }
      return;
    }
    if (
      !activeRepo ||
      !pullRequests.some((pr) => pr.repoFullName === activeRepo)
    ) {
      setActiveRepo(pullRequests[0]?.repoFullName ?? null);
    }
  }, [pullRequests, activeRepo]);

  const activePullRequest = useMemo(() => {
    if (!activeRepo) return null;
    return pullRequests.find((pr) => pr.repoFullName === activeRepo) ?? null;
  }, [pullRequests, activeRepo]);

  const aggregatedUrl = selectedRun?.pullRequestUrl;
  const isPending = aggregatedUrl === "pending";
  const fallbackPullRequestUrl =
    aggregatedUrl && aggregatedUrl !== "pending" ? aggregatedUrl : undefined;

  const persistKey = useMemo(() => {
    const key = activeRepo ? `${runId}:${activeRepo}` : runId;
    return getTaskRunPullRequestPersistKey(key);
  }, [runId, activeRepo]);
  const paneBorderRadius = 6;

  const headerTitle =
    pullRequests.length > 1 ? "Pull Requests" : "Pull Request";
  const activeUrl = activePullRequest?.url ?? fallbackPullRequestUrl;

  let leftContent: ReactNode = null;
  if (pullRequests.length > 0) {
    leftContent = (
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/30">
          {pullRequests.map((pr) => {
            const isActive = pr.repoFullName === activeRepo;
            return (
              <button
                key={pr.repoFullName}
                onClick={() => setActiveRepo(pr.repoFullName)}
                className={clsx(
                  "flex min-w-[160px] items-center justify-between gap-2 px-3 py-2 text-xs transition-colors",
                  isActive
                    ? "border-b-2 border-neutral-900 bg-white text-neutral-900 dark:border-neutral-100 dark:bg-neutral-950 dark:text-neutral-100"
                    : "border-b-2 border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
                )}
              >
                <span className="truncate">{pr.repoFullName}</span>
                <span className="text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                  {pr.state ?? "none"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex-1 min-h-0">
          {activePullRequest?.url ? (
            <PersistentWebView
              persistKey={persistKey}
              src={activePullRequest.url}
              className="w-full h-full border-0"
              borderRadius={paneBorderRadius}
              forceWebContentsViewIfElectron
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-sm text-neutral-500 dark:text-neutral-400">
              No pull request URL available for this repository yet.
            </div>
          )}
        </div>
      </div>
    );
  } else if (isPending) {
    leftContent = (
      <div className="flex flex-col items-center justify-center h-full text-neutral-500 dark:text-neutral-400">
        <div className="w-8 h-8 border-2 border-neutral-300 dark:border-neutral-600 border-t-blue-500 rounded-full animate-spin mb-4" />
        <p className="text-sm">Pull request is being created...</p>
      </div>
    );
  } else if (fallbackPullRequestUrl) {
    leftContent = (
      <PersistentWebView
        persistKey={persistKey}
        src={fallbackPullRequestUrl}
        className="w-full h-full border-0"
        borderRadius={paneBorderRadius}
        forceWebContentsViewIfElectron
      />
    );
  } else {
    leftContent = (
      <div className="flex flex-col items-center justify-center h-full text-neutral-500 dark:text-neutral-400">
        <svg
          className="w-16 h-16 mb-4 text-neutral-300 dark:text-neutral-700"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-sm font-medium mb-1">No pull request</p>
        <p className="text-xs text-center">
          This run doesn't have any associated pull requests yet.
        </p>
      </div>
    );
  }

  return (
    <FloatingPane>
      <div className="flex h-full min-h-0 flex-col relative isolate">
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {/* Header */}
          <div className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {headerTitle}
              </h2>
              {selectedRun?.pullRequestState && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                  {selectedRun.pullRequestState}
                </span>
              )}
            </div>
            {activeUrl && (
              <a
                href={activeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
              >
                Open in GitHub
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
            )}
          </div>

          {/* Task description */}
          {task?.text && (
            <div className="px-4 py-2 border-b border-neutral-200 dark:border-neutral-800">
              <div className="text-xs text-neutral-600 dark:text-neutral-300">
                <span className="text-neutral-500 dark:text-neutral-400 select-none">
                  Task:{" "}
                </span>
                <span className="font-medium">{task.text}</span>
              </div>
            </div>
          )}

          {/* Main content */}
          <div className="flex-1 bg-white dark:bg-neutral-950 flex">
            <div className="flex-1 min-h-0">{leftContent}</div>
            <PullRequestCommentsPanel
              teamSlugOrId={teamSlugOrId}
              pullRequest={activePullRequest}
            />
          </div>
        </div>
      </div>
    </FloatingPane>
  );
}

type CommentsPanelProps = {
  teamSlugOrId: string;
  pullRequest: RunPullRequest | null;
};

type ReactionCounts = NonNullable<PullRequestComment["reactions"]>;

const reactionEmojiMap: Record<
  keyof Omit<ReactionCounts, "totalCount">,
  string
> = {
  plusOne: "👍",
  minusOne: "👎",
  laugh: "😄",
  confused: "😕",
  heart: "❤️",
  hooray: "🎉",
  rocket: "🚀",
  eyes: "👀",
};

function PullRequestCommentsPanel({
  teamSlugOrId,
  pullRequest,
}: CommentsPanelProps) {
  const ensureSynced = useMutation(api.github_pr_comments.ensureSynced);
  const ensuredRef = useRef<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const repoFullName = pullRequest?.repoFullName;
  const number = pullRequest?.number;

  const commentsResult = useQuery(
    repoFullName && typeof number === "number"
      ? api.github_pr_comments.listForPullRequest
      : undefined,
    repoFullName && typeof number === "number"
      ? { teamSlugOrId, repoFullName, number }
      : undefined,
  );

  useEffect(() => {
    if (!repoFullName || typeof number !== "number") return;
    const key = `${repoFullName}#${number}`;
    if (ensuredRef.current.has(key)) return;
    ensuredRef.current.add(key);
    ensureSynced({ teamSlugOrId, repoFullName, number }).catch((error) => {
      console.error("[PullRequestCommentsPanel] ensureSynced failed", error);
    });
  }, [ensureSynced, number, repoFullName, teamSlugOrId]);

  const comments = (commentsResult?.comments as PullRequestComment[]) ?? [];
  const syncedAt = commentsResult?.commentsSyncedAt ?? null;
  const canSync = Boolean(repoFullName && typeof number === "number");
  const isLoading = Boolean(
    repoFullName && typeof number === "number" && commentsResult === undefined,
  );

  const handleRefresh = async () => {
    if (!repoFullName || typeof number !== "number") return;
    setIsRefreshing(true);
    try {
      await ensureSynced({
        teamSlugOrId,
        repoFullName,
        number,
        force: true,
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const syncedLabel = (() => {
    if (!repoFullName || typeof number !== "number") {
      return "Select a pull request";
    }
    if (syncedAt) {
      return `Synced ${formatDistanceToNow(syncedAt, { addSuffix: true })}`;
    }
    return "Syncing comments…";
  })();

  let panelBody: ReactNode = null;
  if (!repoFullName || typeof number !== "number") {
    panelBody = (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Pick a pull request above to see its GitHub comments.
      </p>
    );
  } else if (isLoading) {
    panelBody = (
      <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        <div className="w-4 h-4 border-2 border-neutral-300 dark:border-neutral-600 border-t-blue-500 rounded-full animate-spin" />
        Loading comments…
      </div>
    );
  } else if (comments.length === 0) {
    panelBody = (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        No comments have been synced for this pull request yet.
      </p>
    );
  } else {
    panelBody = (
      <div className="space-y-3">
        {comments.map((comment) => (
          <PullRequestCommentCard key={comment._id} comment={comment} />
        ))}
      </div>
    );
  }

  return (
    <aside className="w-full max-w-[360px] min-w-[280px] shrink-0 border-l border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/40 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
        <div>
          <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            Comments
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {syncedLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={!canSync || isRefreshing}
          className={clsx(
            "text-xs px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-200 hover:bg-white/60 dark:hover:bg-white/5 transition disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">{panelBody}</div>
    </aside>
  );
}

function PullRequestCommentCard({ comment }: { comment: PullRequestComment }) {
  const timeLabel = formatDistanceToNow(comment.createdAt, {
    addSuffix: true,
  });
  const badge = getCommentBadge(comment);
  const lineNumber = comment.line ?? comment.originalLine;
  const pathLabel = comment.path
    ? `${comment.path}${
        typeof lineNumber === "number" ? ` · line ${lineNumber}` : ""
      }`
    : null;
  const reactionEntries = getReactionEntries(comment.reactions);
  const bodyContent =
    comment.body && comment.body.trim().length > 0 ? (
      <div className="prose prose-neutral dark:prose-invert prose-sm max-w-none prose-p:my-1.5 prose-p:leading-relaxed prose-headings:mt-3 prose-headings:mb-2 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:bg-neutral-200 dark:prose-code:bg-neutral-700 prose-code:text-[13px] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {comment.body}
        </ReactMarkdown>
      </div>
    ) : (
      <p className="text-xs italic text-neutral-500 dark:text-neutral-400">
        No content provided.
      </p>
    );

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {comment.authorAvatarUrl ? (
            <img
              src={comment.authorAvatarUrl}
              alt={comment.authorLogin ?? "GitHub user"}
              className="w-7 h-7 rounded-full"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-xs font-semibold text-neutral-600 dark:text-neutral-200">
              {(comment.authorLogin ?? "?").slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {comment.authorLogin ?? "GitHub user"}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {timeLabel}
            </p>
          </div>
        </div>
        <span
          className={clsx(
            "px-2 py-0.5 text-[11px] rounded-full font-semibold capitalize",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      </div>
      {pathLabel && (
        <div className="mt-2 text-xs font-mono text-neutral-500 dark:text-neutral-400">
          {pathLabel}
        </div>
      )}
      {comment.diffHunk && comment.commentType === "review_comment" && (
        <pre className="mt-2 text-[11px] leading-snug bg-neutral-100 dark:bg-neutral-800 rounded-md p-2 overflow-x-auto text-neutral-800 dark:text-neutral-100">
          {comment.diffHunk}
        </pre>
      )}
      <div className="mt-2">{bodyContent}</div>
      {reactionEntries.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {reactionEntries.map((reaction) => (
            <span
              key={reaction.key}
              className="flex items-center gap-1 rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-xs text-neutral-700 dark:text-neutral-200"
            >
              <span>{reaction.emoji}</span>
              <span>{reaction.count}</span>
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
        {comment.authorAssociation && (
          <span className="uppercase tracking-wide">
            {comment.authorAssociation}
          </span>
        )}
        {comment.htmlUrl && (
          <a
            href={comment.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
          >
            View on GitHub
          </a>
        )}
      </div>
    </div>
  );
}

function getReactionEntries(reactions?: ReactionCounts) {
  if (!reactions || reactions.totalCount <= 0) return [];
  return (Object.keys(reactionEmojiMap) as Array<keyof typeof reactionEmojiMap>)
    .map((key) => ({
      key,
      emoji: reactionEmojiMap[key],
      count: reactions[key] ?? 0,
    }))
    .filter((entry) => entry.count > 0);
}

function getCommentBadge(comment: PullRequestComment) {
  if (comment.commentType === "review") {
    const label = formatLabel(comment.state ?? "review");
    if (comment.state === "approved") {
      return {
        label,
        className:
          "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
      };
    }
    if (comment.state === "changes_requested") {
      return {
        label,
        className:
          "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
      };
    }
    return {
      label,
      className:
        "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
    };
  }
  if (comment.commentType === "review_comment") {
    return {
      label: "Inline",
      className:
        "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    };
  }
  return {
    label: "Conversation",
    className:
      "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
  };
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
