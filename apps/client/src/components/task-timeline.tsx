import { api } from "@cmux/convex/api";
import { type Doc, type Id } from "@cmux/convex/dataModel";
import type { RunEnvironmentSummary } from "@/types/task";
import { useUser } from "@stackframe/react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  GitPullRequest,
  Play,
  Sparkles,
  Trophy,
  XCircle,
  Loader2,
} from "lucide-react";
import { useMemo, useState } from "react";
import CmuxLogoMark from "./logo/cmux-logo-mark";
import { TaskMessage } from "./task-message";
import { cn } from "@/lib/utils";

type TaskRunStatus = "pending" | "running" | "completed" | "failed" | "skipped";

interface TimelineEvent {
  id: string;
  type:
    | "task_created"
    | "run_started"
    | "run_completed"
    | "run_failed"
    | "run_skipped"
    | "crown_evaluation";
  timestamp: number;
  runId?: Id<"taskRuns">;
  agentName?: string;
  status?: TaskRunStatus;
  exitCode?: number;
  isCrowned?: boolean;
  crownReason?: string;
  summary?: string;
  userId?: string;
  // Enhanced fields for richer UI
  pullRequests?: Array<{
    repoFullName: string;
    url?: string;
    number?: number;
    state: "none" | "draft" | "open" | "merged" | "closed" | "unknown";
    isDraft?: boolean;
  }>;
  pullRequestUrl?: string;
  screenshotUrl?: string;
  latestScreenshotSetId?: Id<"taskRunScreenshotSets">;
}

type TaskRunWithChildren = Doc<"taskRuns"> & {
  children?: TaskRunWithChildren[];
  environment?: RunEnvironmentSummary | null;
};

interface TaskTimelineProps {
  task?: Doc<"tasks"> | null;
  taskRuns: TaskRunWithChildren[] | null;
  crownEvaluation?: {
    evaluatedAt?: number;
    winnerRunId?: Id<"taskRuns">;
    reason?: string;
  } | null;
}

const PR_STATE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: {
    bg: "bg-neutral-100 dark:bg-neutral-800",
    text: "text-neutral-600 dark:text-neutral-400",
    label: "Draft",
  },
  open: {
    bg: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-700 dark:text-green-400",
    label: "Open",
  },
  merged: {
    bg: "bg-purple-100 dark:bg-purple-900/30",
    text: "text-purple-700 dark:text-purple-400",
    label: "Merged",
  },
  closed: {
    bg: "bg-red-100 dark:bg-red-900/30",
    text: "text-red-700 dark:text-red-400",
    label: "Closed",
  },
  none: {
    bg: "bg-neutral-100 dark:bg-neutral-800",
    text: "text-neutral-500 dark:text-neutral-500",
    label: "No PR",
  },
  unknown: {
    bg: "bg-neutral-100 dark:bg-neutral-800",
    text: "text-neutral-500 dark:text-neutral-500",
    label: "Unknown",
  },
};

function PullRequestBadge({ pr }: { pr: NonNullable<TimelineEvent["pullRequests"]>[number] }) {
  const style = PR_STATE_STYLES[pr.state] || PR_STATE_STYLES.unknown;
  const shortRepo = pr.repoFullName.split("/").pop() || pr.repoFullName;

  if (pr.url) {
    return (
      <a
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium transition-opacity hover:opacity-80",
          style.bg,
          style.text
        )}
      >
        <GitPullRequest className="size-3" />
        <span className="max-w-[100px] truncate">{shortRepo}</span>
        {pr.number && <span>#{pr.number}</span>}
        <ExternalLink className="size-2.5 opacity-60" />
      </a>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium",
        style.bg,
        style.text
      )}
    >
      <GitPullRequest className="size-3" />
      <span className="max-w-[100px] truncate">{shortRepo}</span>
      <span className="opacity-60">({style.label})</span>
    </span>
  );
}

function ExpandableReason({
  reason,
  variant = "crown"
}: {
  reason: string;
  variant?: "crown" | "evaluation"
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isLong = reason.length > 150;
  const displayText = isLong && !isExpanded ? reason.slice(0, 150) + "..." : reason;

  const styles = variant === "crown"
    ? "text-amber-700 dark:text-amber-400 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 border-amber-200 dark:border-amber-800"
    : "text-purple-700 dark:text-purple-400 bg-gradient-to-r from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20 border-purple-200 dark:border-purple-800";

  const Icon = variant === "crown" ? Trophy : Sparkles;

  return (
    <div className={cn("mt-2 text-[13px] rounded-lg p-3 border", styles)}>
      <div className="flex items-start gap-2">
        <Icon className="size-4 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="leading-relaxed">{displayText}</p>
          {isLong && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-1 text-xs font-medium opacity-70 hover:opacity-100 inline-flex items-center gap-0.5"
            >
              {isExpanded ? (
                <>Show less <ChevronUp className="size-3" /></>
              ) : (
                <>Show more <ChevronDown className="size-3" /></>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RunCompletionCard({
  event,
  teamSlugOrId,
  taskId,
}: {
  event: TimelineEvent;
  teamSlugOrId: string;
  taskId: Id<"tasks">;
}) {
  const agentName = event.agentName || "Agent";
  const hasPRs = event.pullRequests && event.pullRequests.length > 0;

  return (
    <div className={cn(
      "rounded-lg border p-3 transition-all",
      event.isCrowned
        ? "border-amber-300 dark:border-amber-700 bg-gradient-to-br from-amber-50/80 to-yellow-50/50 dark:from-amber-950/30 dark:to-yellow-950/20 shadow-sm shadow-amber-100 dark:shadow-amber-900/20"
        : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50"
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <Link
          to="/$teamSlugOrId/task/$taskId/run/$runId"
          params={{
            teamSlugOrId,
            taskId,
            runId: event.runId!,
            taskRunId: event.runId!,
          }}
          className="group flex items-center gap-2 hover:underline"
        >
          {event.isCrowned ? (
            <div className="size-5 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center shadow-sm">
              <Trophy className="size-3 text-white" />
            </div>
          ) : (
            <div className="size-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="size-3 text-green-600 dark:text-green-400" />
            </div>
          )}
          <span className="font-medium text-sm text-neutral-900 dark:text-neutral-100">
            {agentName}
          </span>
          {event.isCrowned && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200">
              WINNER
            </span>
          )}
        </Link>
        <span className="text-[11px] text-neutral-500 dark:text-neutral-500 whitespace-nowrap">
          {formatDistanceToNow(event.timestamp, { addSuffix: true })}
        </span>
      </div>

      {/* PR Badges */}
      {hasPRs && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {event.pullRequests!.map((pr) => (
            <PullRequestBadge key={pr.repoFullName} pr={pr} />
          ))}
        </div>
      )}

      {/* Summary */}
      {event.summary && (
        <div className="text-[13px] text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900 rounded-md p-2.5 leading-relaxed">
          {event.summary}
        </div>
      )}

      {/* Crown Reason */}
      {event.crownReason && (
        <ExpandableReason reason={event.crownReason} variant="crown" />
      )}

      {/* Screenshot Preview */}
      {event.screenshotUrl && (
        <div className="mt-2 rounded-md overflow-hidden border border-neutral-200 dark:border-neutral-800">
          <img
            src={event.screenshotUrl}
            alt="Preview"
            className="w-full h-24 object-cover bg-neutral-100 dark:bg-neutral-800"
          />
        </div>
      )}
    </div>
  );
}

function RunningIndicator({ agentName }: { agentName: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="relative">
        <div className="size-4 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
          <Loader2 className="size-2.5 text-blue-600 dark:text-blue-400 animate-spin" />
        </div>
        <span className="absolute -top-0.5 -right-0.5 size-2 bg-blue-500 rounded-full animate-pulse" />
      </div>
      <span className="text-xs">
        <span className="font-medium text-neutral-900 dark:text-neutral-100">{agentName}</span>
        <span className="text-neutral-500 dark:text-neutral-400"> is working...</span>
      </span>
    </div>
  );
}

export function TaskTimeline({
  task,
  taskRuns,
  crownEvaluation,
}: TaskTimelineProps) {
  const user = useUser();
  const params = useParams({ from: "/_layout/$teamSlugOrId/task/$taskId" });
  const taskComments = useQuery(api.taskComments.listByTask, {
    teamSlugOrId: params.teamSlugOrId,
    taskId: params.taskId as Id<"tasks">,
  });

  const events = useMemo(() => {
    const timelineEvents: TimelineEvent[] = [];

    // Add task creation event
    if (task?.createdAt) {
      timelineEvents.push({
        id: "task-created",
        type: "task_created",
        timestamp: task.createdAt,
        userId: task.userId,
      });
    }

    if (!taskRuns) return timelineEvents;

    // Flatten the tree structure to get all runs
    const flattenRuns = (runs: TaskRunWithChildren[]): TaskRunWithChildren[] => {
      const result: TaskRunWithChildren[] = [];
      runs.forEach((run) => {
        result.push(run);
        if (run.children?.length) {
          result.push(...flattenRuns(run.children));
        }
      });
      return result;
    };

    const allRuns = flattenRuns(taskRuns);

    // Add run events
    allRuns.forEach((run) => {
      // Run started event
      timelineEvents.push({
        id: `${run._id}-start`,
        type: "run_started",
        timestamp: run.createdAt,
        runId: run._id,
        agentName: run.agentName,
        status: run.status,
      });

      // Run completed/failed event
      if (run.completedAt) {
        const endEventType: TimelineEvent["type"] =
          run.status === "failed"
            ? "run_failed"
            : run.status === "skipped"
              ? "run_skipped"
              : "run_completed";

        timelineEvents.push({
          id: `${run._id}-end`,
          type: endEventType,
          timestamp: run.completedAt,
          runId: run._id,
          agentName: run.agentName,
          status: run.status,
          exitCode: run.exitCode,
          summary: run.summary,
          isCrowned: run.isCrowned,
          crownReason: run.crownReason,
          pullRequests: run.pullRequests,
          pullRequestUrl: run.pullRequestUrl,
          latestScreenshotSetId: run.latestScreenshotSetId,
        });
      }
    });

    // Add crown evaluation event if exists
    if (crownEvaluation?.evaluatedAt) {
      timelineEvents.push({
        id: "crown-evaluation",
        type: "crown_evaluation",
        timestamp: crownEvaluation.evaluatedAt,
        runId: crownEvaluation.winnerRunId,
        crownReason: crownEvaluation.reason,
      });
    }

    // Sort by timestamp
    return timelineEvents.sort((a, b) => a.timestamp - b.timestamp);
  }, [task, taskRuns, crownEvaluation]);

  // Track running agents
  const runningAgents = useMemo(() => {
    if (!taskRuns) return [];
    const flattenRuns = (runs: TaskRunWithChildren[]): TaskRunWithChildren[] => {
      const result: TaskRunWithChildren[] = [];
      runs.forEach((run) => {
        result.push(run);
        if (run.children?.length) {
          result.push(...flattenRuns(run.children));
        }
      });
      return result;
    };
    return flattenRuns(taskRuns).filter(run => run.status === "running");
  }, [taskRuns]);

  if (!events.length && !task) {
    return (
      <div className="flex items-center justify-center py-12 text-neutral-500">
        <Clock className="h-5 w-5 mr-2" />
        <span className="text-sm">No activity yet</span>
      </div>
    );
  }

  const ActivityEvent = ({ event }: { event: TimelineEvent }) => {
    const agentName = event.agentName || "Agent";

    // Use card layout for completed runs
    if (event.type === "run_completed") {
      return (
        <div className="w-full">
          <RunCompletionCard
            event={event}
            teamSlugOrId={params.teamSlugOrId}
            taskId={params.taskId}
          />
        </div>
      );
    }

    let icon;
    let content;

    switch (event.type) {
      case "task_created":
        icon = (
          <img
            src={user?.profileImageUrl || ""}
            alt={user?.primaryEmail || "User"}
            className="size-4 rounded-full"
          />
        );
        content = (
          <>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">
              {user?.displayName || user?.primaryEmail || "User"}
            </span>
            <span className="text-neutral-600 dark:text-neutral-400">
              {" "}
              created the task
            </span>
            <span className="text-neutral-500 dark:text-neutral-500 ml-1">
              {formatDistanceToNow(event.timestamp, { addSuffix: true })}
            </span>
          </>
        );
        break;
      case "run_started":
        icon = (
          <div className="size-4 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Play className="size-[9px] text-blue-600 dark:text-blue-400" />
          </div>
        );
        content = event.runId ? (
          <Link
            to="/$teamSlugOrId/task/$taskId/run/$runId"
            params={{
              teamSlugOrId: params.teamSlugOrId,
              taskId: params.taskId,
              runId: event.runId,
              taskRunId: event.runId,
            }}
            className="hover:underline inline"
          >
            <span className="font-medium text-neutral-900 dark:text-neutral-100">
              {agentName}
            </span>
            <span className="text-neutral-600 dark:text-neutral-400">
              {" "}
              started working
            </span>
            <span className="text-neutral-500 dark:text-neutral-500 ml-1">
              {formatDistanceToNow(event.timestamp, { addSuffix: true })}
            </span>
          </Link>
        ) : (
          <>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">
              {agentName}
            </span>
            <span className="text-neutral-600 dark:text-neutral-400">
              {" "}
              started working
            </span>
            <span className="text-neutral-500 dark:text-neutral-500 ml-1">
              {formatDistanceToNow(event.timestamp, { addSuffix: true })}
            </span>
          </>
        );
        break;
      case "run_failed":
        icon = (
          <div className="size-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <XCircle className="size-2.5 text-red-600 dark:text-red-400" />
          </div>
        );
        content = (
          <>
            {event.runId ? (
              <Link
                to="/$teamSlugOrId/task/$taskId/run/$runId"
                params={{
                  teamSlugOrId: params.teamSlugOrId,
                  taskId: params.taskId,
                  runId: event.runId,
                  taskRunId: event.runId,
                }}
                className="hover:underline inline"
              >
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {agentName}
                </span>
                <span className="text-neutral-600 dark:text-neutral-400">
                  {" "}
                  failed
                </span>
                <span className="text-neutral-500 dark:text-neutral-500 ml-1">
                  {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                </span>
              </Link>
            ) : (
              <>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {agentName}
                </span>
                <span className="text-neutral-600 dark:text-neutral-400">
                  {" "}
                  failed
                </span>
                <span className="text-neutral-500 dark:text-neutral-500 ml-1">
                  {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                </span>
              </>
            )}
            {event.exitCode !== undefined && event.exitCode !== 0 && (
              <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                Exit code: {event.exitCode}
              </div>
            )}
          </>
        );
        break;
      case "run_skipped":
        icon = (
          <div className="size-4 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <AlertCircle className="size-2.5 text-amber-600 dark:text-amber-400" />
          </div>
        );
        content = (
          <>
            {event.runId ? (
              <Link
                to="/$teamSlugOrId/task/$taskId/run/$runId"
                params={{
                  teamSlugOrId: params.teamSlugOrId,
                  taskId: params.taskId,
                  runId: event.runId,
                  taskRunId: event.runId,
                }}
                className="hover:underline inline"
              >
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {agentName}
                </span>
                <span className="text-neutral-600 dark:text-neutral-400">
                  {" "}
                  skipped execution
                </span>
                <span className="text-neutral-500 dark:text-neutral-500 ml-1">
                  {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                </span>
              </Link>
            ) : (
              <>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {agentName}
                </span>
                <span className="text-neutral-600 dark:text-neutral-400">
                  {" "}
                  skipped execution
                </span>
                <span className="text-neutral-500 dark:text-neutral-500 ml-1">
                  {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                </span>
              </>
            )}
          </>
        );
        break;
      case "crown_evaluation":
        icon = (
          <div className="size-4 rounded-full bg-gradient-to-br from-purple-400 to-violet-500 flex items-center justify-center">
            <Sparkles className="size-2.5 text-white" />
          </div>
        );
        content = (
          <div className="w-full">
            <div className="flex items-center gap-2 mb-1">
              {event.runId ? (
                <Link
                  to="/$teamSlugOrId/task/$taskId/run/$runId"
                  params={{
                    teamSlugOrId: params.teamSlugOrId,
                    taskId: params.taskId,
                    runId: event.runId,
                    taskRunId: event.runId,
                  }}
                  className="hover:underline inline"
                >
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">
                    Crown evaluation
                  </span>
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {" "}
                    completed
                  </span>
                </Link>
              ) : (
                <>
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">
                    Crown evaluation
                  </span>
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {" "}
                    completed
                  </span>
                </>
              )}
              <span className="text-neutral-500 dark:text-neutral-500">
                {formatDistanceToNow(event.timestamp, { addSuffix: true })}
              </span>
            </div>
            {event.crownReason && (
              <ExpandableReason reason={event.crownReason} variant="evaluation" />
            )}
          </div>
        );
        break;
      default:
        icon = (
          <div className="size-4 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
            <AlertCircle className="size-2.5 text-neutral-600 dark:text-neutral-400" />
          </div>
        );
        content = (
          <>
            <span className="text-neutral-600 dark:text-neutral-400">
              Unknown event
            </span>
            <span className="text-neutral-500 dark:text-neutral-500 ml-1">
              {formatDistanceToNow(event.timestamp, { addSuffix: true })}
            </span>
          </>
        );
    }

    return (
      <>
        <div className="shrink-0 flex items-start justify-center">{icon}</div>
        <div className="flex-1 min-w-0 flex items-center">
          <div className="text-xs">
            <div>{content}</div>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="space-y-2">
      {/* Prompt Message */}
      {task?.text && (
        <TaskMessage
          authorName={
            user?.displayName || user?.primaryEmail?.split("@")[0] || "User"
          }
          authorImageUrl={user?.profileImageUrl || ""}
          authorAlt={user?.primaryEmail || "User"}
          timestamp={task.createdAt}
          content={task.text}
        />
      )}

      {/* Running Agents Indicator */}
      {runningAgents.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2.5 mb-3">
          <div className="text-[11px] font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-1.5">
            Currently Running
          </div>
          <div className="space-y-1">
            {runningAgents.map((run) => (
              <RunningIndicator key={run._id} agentName={run.agentName || "Agent"} />
            ))}
          </div>
        </div>
      )}

      <div>
        {/* Timeline Events */}
        <div className="space-y-4 pl-5">
          {events.map((event, index) => (
            <div key={event.id} className="relative flex gap-3">
              <ActivityEvent event={event} />
              {index < events.length - 1 && (
                <div className="absolute left-1.5 top-5 -bottom-3 w-px transform translate-x-[1px] bg-neutral-200 dark:bg-neutral-800" />
              )}
            </div>
          ))}
        </div>
      </div>
      {/* Task Comments (chronological) */}
      {taskComments && taskComments.length > 0 ? (
        <div className="space-y-2 pt-2">
          {taskComments.map((c) => (
            <TaskMessage
              key={c._id}
              authorName={
                c.userId === "cmux"
                  ? "cmux"
                  : user?.displayName ||
                    user?.primaryEmail?.split("@")[0] ||
                    "User"
              }
              avatar={
                c.userId === "cmux" ? (
                  <CmuxLogoMark height={20} label="cmux" />
                ) : undefined
              }
              authorImageUrl={
                c.userId === "cmux" ? undefined : user?.profileImageUrl || ""
              }
              authorAlt={
                c.userId === "cmux" ? "cmux" : user?.primaryEmail || "User"
              }
              timestamp={c.createdAt}
              content={c.content}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
