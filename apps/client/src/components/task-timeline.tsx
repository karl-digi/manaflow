import { api } from "@cmux/convex/api";
import { type Doc, type Id } from "@cmux/convex/dataModel";
import type { RunEnvironmentSummary } from "@/types/task";
import { useUser } from "@stackframe/react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Trophy,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import CmuxLogoMark from "./logo/cmux-logo-mark";
import { TaskMessage } from "./task-message";
import { ConfirmDialog } from "./ui/confirm-dialog";

const RETRY_COOLDOWN_MS = 30_000;

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
  /** Whether this crown evaluation was a fallback due to AI service failure */
  isFallback?: boolean;
  /** Human-readable note about the evaluation process */
  evaluationNote?: string;
  /** Whether this crown evaluation is currently in progress (initial evaluation, not retry) */
  isEvaluating?: boolean;
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
    /** Whether this evaluation was produced by fallback due to AI service failure */
    isFallback?: boolean;
    /** Human-readable note about the evaluation process */
    evaluationNote?: string;
    /** Whether all candidates had empty diffs at evaluation time */
    hadEmptyDiffs?: boolean;
    /** Number of auto-refresh attempts */
    autoRefreshCount?: number;
  } | null;
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

  const retryCrownEvaluationMutation = useMutation(api.crown.retryCrownEvaluation);
  const refreshCrownEvaluationMutation = useMutation(api.crown.refreshCrownEvaluation);

  // Optimistic state for immediate UI feedback on click
  const [isSubmittingRetry, setIsSubmittingRetry] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // State for refresh confirmation dialog
  const [showRefreshConfirm, setShowRefreshConfirm] = useState(false);
  const prevCrownStatusRef = useRef<Doc<"tasks">["crownEvaluationStatus"]>(
    undefined
  );
  const prevCrownErrorRef = useRef<string | undefined>(undefined);
  // Track status/error at the moment we started submitting to detect transitions
  const statusAtRetryStartRef = useRef<Doc<"tasks">["crownEvaluationStatus"]>(undefined);
  const errorAtRetryStartRef = useRef<string | undefined>(undefined);

  // Track retry state from server
  const isRetryingFromServer =
    task?.crownEvaluationStatus === "pending" ||
    task?.crownEvaluationStatus === "in_progress";

  // Reset optimistic state when server confirms it's retrying (handoff complete)
  // or when retry finishes (status changes to error/succeeded after we started)
  useEffect(() => {
    if (isSubmittingRetry) {
      if (isRetryingFromServer) {
        // Server took over - handoff complete, clear optimistic state
        setIsSubmittingRetry(false);
        statusAtRetryStartRef.current = undefined;
        errorAtRetryStartRef.current = undefined;
      } else if (statusAtRetryStartRef.current !== undefined) {
        // Check if status changed, or if error message changed (error -> error with new message)
        const statusChanged = task?.crownEvaluationStatus !== statusAtRetryStartRef.current;
        const errorChanged = task?.crownEvaluationError !== errorAtRetryStartRef.current;
        if (statusChanged || errorChanged) {
          // Retry completed (success or failure) - clear optimistic state
          setIsSubmittingRetry(false);
          statusAtRetryStartRef.current = undefined;
          errorAtRetryStartRef.current = undefined;
        }
      }
    }
  }, [isSubmittingRetry, isRetryingFromServer, task?.crownEvaluationStatus, task?.crownEvaluationError]);

  // Notify users when evaluation is unavailable
  useEffect(() => {
    const status = task?.crownEvaluationStatus;
    const prevStatus = prevCrownStatusRef.current;
    const errorMessage = task?.crownEvaluationError;
    const prevErrorMessage = prevCrownErrorRef.current;

    // Avoid showing on initial mount/refresh when already in error.
    const shouldNotify =
      status === "error" &&
      ((prevStatus !== undefined && prevStatus !== "error") ||
        (prevStatus === "error" &&
          !!errorMessage &&
          errorMessage !== prevErrorMessage));

    if (shouldNotify) {
      toast.error("Evaluation unavailable", {
        id: task?._id ? `crown-evaluation-unavailable:${task._id}` : undefined,
        description:
          errorMessage ||
          "Crown evaluation failed. No winner was selected.",
      });
    }

    prevCrownStatusRef.current = status;
    prevCrownErrorRef.current = errorMessage;
  }, [task?._id, task?.crownEvaluationStatus, task?.crownEvaluationError]);

  // Combined state: optimistic (immediate) OR server state (after round-trip)
  const isRetrying = isSubmittingRetry || isRetryingFromServer;

  const lastRetryAt = task?.crownEvaluationLastRetryAt ?? 0;
  const retryCount = task?.crownEvaluationRetryCount ?? 0;
  const cooldownRemainingMs =
    task?.crownEvaluationStatus === "error"
      ? Math.max(0, RETRY_COOLDOWN_MS - (nowMs - lastRetryAt))
      : 0;
  const cooldownSeconds = Math.ceil(cooldownRemainingMs / 1000);
  const isRetryCooldownActive = cooldownRemainingMs > 0;

  // Tick a local clock to keep the cooldown label fresh while status is error
  useEffect(() => {
    if (task?.crownEvaluationStatus !== "error" || !lastRetryAt) {
      return;
    }
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [task?.crownEvaluationStatus, lastRetryAt]);

  const handleRetryEvaluation = async () => {
    if (!task?._id || isRetrying || isRetryCooldownActive) return;
    // Capture current status/error to detect immediate failures (error -> error transitions)
    statusAtRetryStartRef.current = task.crownEvaluationStatus;
    errorAtRetryStartRef.current = task.crownEvaluationError;
    setIsSubmittingRetry(true); // Optimistic: show "Retrying..." immediately
    try {
      await retryCrownEvaluationMutation({
        teamSlugOrId: params.teamSlugOrId,
        taskId: task._id,
      });
      // Server state will take over via isRetryingFromServer
    } catch (error) {
      console.error("[TaskTimeline] Failed to retry crown evaluation:", error);
      setIsSubmittingRetry(false); // Revert on error
      statusAtRetryStartRef.current = undefined;
      errorAtRetryStartRef.current = undefined;
    }
  };

  // Handle refresh for succeeded evaluations
  // Requires confirmation if evaluation doesn't have empty diffs
  const handleRefreshEvaluation = async () => {
    if (!task?._id || isRetrying || isRetryCooldownActive) return;

    // Require confirmation if this evaluation didn't have empty diffs
    // (user is refreshing a complete evaluation)
    if (!crownEvaluation?.hadEmptyDiffs) {
      setShowRefreshConfirm(true);
      return;
    }

    // Proceed with refresh directly if evaluation had empty diffs
    await executeRefresh();
  };

  // Execute the actual refresh mutation
  const executeRefresh = async () => {
    if (!task?._id) return;

    // Use the same state tracking as retry for UI consistency
    statusAtRetryStartRef.current = task.crownEvaluationStatus;
    errorAtRetryStartRef.current = task.crownEvaluationError;
    setIsSubmittingRetry(true);
    try {
      await refreshCrownEvaluationMutation({
        teamSlugOrId: params.teamSlugOrId,
        taskId: task._id,
      });
    } catch (error) {
      console.error("[TaskTimeline] Failed to refresh crown evaluation:", error);
      setIsSubmittingRetry(false);
      statusAtRetryStartRef.current = undefined;
      errorAtRetryStartRef.current = undefined;
    }
  };

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
    const flattenRuns = (runs: TaskRunWithChildren[]): Doc<"taskRuns">[] => {
      const result: Doc<"taskRuns">[] = [];
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
        });
      }
    });

    // Check if a refresh is in progress (non-destructive: old evaluation exists but we're refreshing)
    const isRefreshInProgress =
      task?.crownEvaluationIsRefreshing === true ||
      (isSubmittingRetry && task?.crownEvaluationStatus === "succeeded");

    // Add crown evaluation event if exists or if status is error/retrying
    if (crownEvaluation?.evaluatedAt && !isRefreshInProgress) {
      // Show existing evaluation (not refreshing)
      timelineEvents.push({
        id: "crown-evaluation",
        type: "crown_evaluation",
        timestamp: crownEvaluation.evaluatedAt,
        runId: crownEvaluation.winnerRunId,
        crownReason: crownEvaluation.reason,
        isFallback: crownEvaluation.isFallback,
        evaluationNote: crownEvaluation.evaluationNote,
      });
    } else if (isRefreshInProgress) {
      // Show refresh in progress indicator
      timelineEvents.push({
        id: "crown-evaluation-refreshing",
        type: "crown_evaluation",
        timestamp: task?.updatedAt || Date.now(),
        isFallback: false,
        isEvaluating: true,
        evaluationNote: "Refreshing crown evaluation with fresh GitHub diffs...",
        crownReason: "Refresh in progress",
      });
    } else if (
      task?.crownEvaluationStatus === "error" ||
      task?.crownEvaluationStatus === "pending" ||
      task?.crownEvaluationStatus === "in_progress" ||
      isSubmittingRetry // Include optimistic state
    ) {
      // Distinguish between initial evaluation and retry scenarios:
      // - Initial evaluation: pending/in_progress with no prior retry attempts
      // - Retry in progress: user clicked retry (optimistic or retryCount > 0)
      // - Failed: error status after evaluation failed
      const isInitialEvaluation =
        (task?.crownEvaluationStatus === "pending" ||
          task?.crownEvaluationStatus === "in_progress") &&
        !isSubmittingRetry &&
        (task?.crownEvaluationRetryCount ?? 0) === 0;

      const isRetryingNow =
        isSubmittingRetry ||
        ((task?.crownEvaluationStatus === "pending" ||
          task?.crownEvaluationStatus === "in_progress") &&
          (task?.crownEvaluationRetryCount ?? 0) > 0);

      // Check if this is a refresh (re-evaluating a previously succeeded evaluation)
      const isRefreshingNow =
        isRetryingNow && task?.crownEvaluationIsRefreshing === true;

      if (isInitialEvaluation || isRefreshingNow) {
        // Initial evaluation OR refresh in progress - show neutral evaluating message
        timelineEvents.push({
          id: "crown-evaluation-pending",
          type: "crown_evaluation",
          timestamp: task?.updatedAt || Date.now(),
          isFallback: false,
          isEvaluating: true,
          evaluationNote: isRefreshingNow
            ? "Refreshing crown evaluation..."
            : "Evaluating submissions...",
          crownReason: isRefreshingNow
            ? "Refresh in progress"
            : "Crown evaluation in progress",
        });
      } else {
        // Failed evaluation or retry in progress - show fallback/retry UI
        timelineEvents.push({
          id: "crown-evaluation-failed",
          type: "crown_evaluation",
          timestamp: task?.updatedAt || Date.now(),
          isFallback: true,
          evaluationNote: isRetryingNow
            ? "Retrying crown evaluation..."
            : task?.crownEvaluationError ||
              "Crown evaluation failed. No winner was selected.",
          crownReason: isRetryingNow ? "Retry in progress" : "Evaluation failed",
        });
      }
    }

    // Sort by timestamp
    return timelineEvents.sort((a, b) => a.timestamp - b.timestamp);
  }, [task, taskRuns, crownEvaluation, isSubmittingRetry]);

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
      case "run_completed":
        icon = event.isCrowned ? (
          <div className="size-4 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Trophy className="size-2.5 text-amber-600 dark:text-amber-400" />
          </div>
        ) : (
          <div className="size-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <CheckCircle2 className="size-2.5 text-green-600 dark:text-green-400" />
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
                  {event.isCrowned
                    ? " completed and won the crown"
                    : " completed"}
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
                  {event.isCrowned
                    ? " completed and won the crown"
                    : " completed"}
                </span>
                <span className="text-neutral-500 dark:text-neutral-500 ml-1">
                  {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                </span>
              </>
            )}
            {event.summary && (
              <div className="mt-2 text-sm text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900 rounded-md p-3">
                {event.summary}
              </div>
            )}
            {event.crownReason && (
              <div className="mt-2 text-[13px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md p-3">
                <Trophy className="inline size-3 mr-2" />
                {event.crownReason}
              </div>
            )}
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
      case "crown_evaluation": {
        // Use different styling based on evaluation state:
        // - Blue for initial evaluation in progress
        // - Amber/orange for fallback (failed or retrying)
        // - Purple for successful evaluation
        icon = event.isEvaluating ? (
          <div className="size-4 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Loader2 className="size-2.5 text-blue-600 dark:text-blue-400 animate-spin" />
          </div>
        ) : event.isFallback ? (
          <div className="size-4 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <AlertCircle className="size-2.5 text-amber-600 dark:text-amber-400" />
          </div>
        ) : (
          <div className="size-4 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
            <Sparkles className="size-2.5 text-purple-600 dark:text-purple-400" />
          </div>
        );
        // Determine display text based on state
        const evalTitle = event.isEvaluating
          ? "Crown evaluation"
          : event.isFallback
            ? "Evaluation unavailable"
            : "Crown evaluation";
        const evalSuffix = event.isEvaluating
          ? " in progress"
          : event.isFallback
            ? " - no winner selected"
            : " completed";

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
                  {evalTitle}
                </span>
                <span className="text-neutral-600 dark:text-neutral-400">
                  {evalSuffix}
                </span>
                <span className="text-neutral-500 dark:text-neutral-500 ml-1">
                  {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                </span>
              </Link>
            ) : (
              <>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {evalTitle}
                </span>
                <span className="text-neutral-600 dark:text-neutral-400">
                  {evalSuffix}
                </span>
                <span className="text-neutral-500 dark:text-neutral-500 ml-1">
                  {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                </span>
              </>
            )}
            {/* Show evaluating note with blue styling */}
            {event.isEvaluating && event.evaluationNote && (
              <div className="mt-2 text-[13px] text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-md p-3">
                <Loader2 className="inline size-3 mr-2 animate-spin" />
                {event.evaluationNote}
              </div>
            )}
            {/* Show fallback notice with amber styling */}
            {event.isFallback && event.evaluationNote && (
              <div className="mt-2 text-[13px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md p-3">
                <AlertCircle className="inline size-3 mr-2" />
                {event.evaluationNote}
              </div>
            )}
            {/* Show retry button for failed evaluations or retrying state */}
            {event.isFallback && (task?.crownEvaluationStatus === "error" || isRetrying) && (
              <button
                type="button"
                onClick={handleRetryEvaluation}
                disabled={isRetrying || isRetryCooldownActive}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 rounded-md transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`size-3 ${isRetrying ? "animate-spin" : ""}`} />
                {isRetrying
                  ? "Retrying..."
                  : isRetryCooldownActive
                    ? `Retry in ${cooldownSeconds}s`
                    : "Retry Evaluation"}
              </button>
            )}
            {event.isFallback && (retryCount > 0 || isRetryCooldownActive) && (
              <div className="mt-1 text-[12px] text-amber-700 dark:text-amber-400">
                {retryCount > 0 ? `Retries used: ${retryCount}` : null}
                {retryCount > 0 && isRetryCooldownActive ? " · " : null}
                {isRetryCooldownActive ? `Cooldown: ${cooldownSeconds}s` : null}
              </div>
            )}
            {/* Show refresh button for all succeeded evaluations */}
            {task?.crownEvaluationStatus === "succeeded" &&
              !isRetrying && (
                <div className="mt-2">
                  {crownEvaluation?.hadEmptyDiffs && (
                    <div className="text-[13px] text-neutral-600 dark:text-neutral-400 mb-2">
                      <AlertCircle className="inline size-3 mr-1.5" />
                      Code diffs may have been incomplete. Try refreshing to fetch updated diffs from GitHub.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleRefreshEvaluation}
                    disabled={isRetryCooldownActive}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded-md transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className="size-3" />
                    {isRetryCooldownActive
                      ? `Refresh in ${cooldownSeconds}s`
                      : "Refresh Evaluation"}
                  </button>
                  {crownEvaluation?.autoRefreshCount !== undefined &&
                    crownEvaluation.autoRefreshCount > 0 && (
                      <div className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-500">
                        Auto-refreshed {crownEvaluation.autoRefreshCount} time
                        {crownEvaluation.autoRefreshCount > 1 ? "s" : ""}
                      </div>
                    )}
                </div>
              )}
            {/* Show refreshing state */}
            {task?.crownEvaluationStatus === "succeeded" &&
              isRetrying && (
                <div className="mt-2">
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 rounded-md opacity-50"
                  >
                    <RefreshCw className="size-3 animate-spin" />
                    Refreshing...
                  </button>
                </div>
              )}
            {/* Show normal crown reason with purple styling */}
            {!event.isFallback && !event.isEvaluating && event.crownReason && (
              <div className="mt-2 text-[13px] text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 rounded-md p-3">
                {event.crownReason}
              </div>
            )}
          </>
        );
        break;
      }
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
          {taskComments.map((c) => {
            const isSystemAuthor =
              c.userId === "manaflow" || c.userId === "cmux";
            return (
              <TaskMessage
                key={c._id}
                authorName={
                  isSystemAuthor
                    ? "Manaflow"
                    : user?.displayName ||
                      user?.primaryEmail?.split("@")[0] ||
                      "User"
                }
                avatar={
                  isSystemAuthor ? (
                    <CmuxLogoMark height={20} label="Manaflow" />
                  ) : undefined
                }
                authorImageUrl={
                  isSystemAuthor ? undefined : user?.profileImageUrl || ""
                }
                authorAlt={
                  isSystemAuthor ? "Manaflow" : user?.primaryEmail || "User"
                }
                timestamp={c.createdAt}
                content={c.content}
              />
            );
          })}
        </div>
      ) : null}

      {/* Refresh confirmation dialog */}
      <ConfirmDialog
        open={showRefreshConfirm}
        onOpenChange={setShowRefreshConfirm}
        title="This evaluation appears complete."
        description="Re-running may produce different results. Continue?"
        confirmLabel="OK"
        cancelLabel="Cancel"
        onConfirm={executeRefresh}
      />
    </div>
  );
}
