import { useState } from "react";
import {
  Clock,
  GitBranch,
  AlertTriangle,
  MessageSquare,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import clsx from "clsx";
import { STATUS_CONFIG, type TaskStatus } from "./status-config";
import type { OrchestrationTaskWithDeps } from "./OrchestrationDashboard";
import { OrchestrationMessageDialog } from "./OrchestrationMessageDialog";
import { useMutation } from "@tanstack/react-query";
import { useConvex } from "convex/react";
import { api } from "@cmux/convex/api";
import { toast } from "sonner";

interface OrchestrationTaskRowProps {
  task: OrchestrationTaskWithDeps;
  teamSlugOrId: string;
}

export function OrchestrationTaskRow({ task, teamSlugOrId }: OrchestrationTaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const convex = useConvex();

  const status = task.status as TaskStatus;
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const createdAt = new Date(task.createdAt).toLocaleString();
  const hasError = status === "failed" && task.errorMessage;
  const hasDependencies = task.dependencyInfo && task.dependencyInfo.totalDeps > 0;
  const isBlocked = hasDependencies && task.dependencyInfo && task.dependencyInfo.pendingDeps > 0;
  const canCancel = status === "pending" || status === "assigned";
  const canMessage = status === "running" && task.taskRunId;

  const cancelMutation = useMutation({
    mutationFn: async () => {
      await convex.mutation(api.orchestrationQueries.cancelTask, {
        taskId: task._id,
      });
    },
    onSuccess: () => {
      toast.success("Task cancelled");
    },
    onError: (error) => {
      toast.error(`Failed to cancel: ${error.message}`);
    },
  });

  return (
    <>
      <div
        className={clsx(
          "px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50",
          status === "running" && "bg-blue-50/50 dark:bg-blue-900/10"
        )}
      >
        {/* Top row: status + agent + actions */}
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
              config.bgColor
            )}
          >
            <Icon
              className={clsx(
                "size-3",
                config.color,
                status === "running" && "animate-spin"
              )}
            />
            <span className={config.color}>{config.label}</span>
          </span>

          {task.assignedAgentName && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {task.assignedAgentName}
            </span>
          )}

          {isBlocked && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              Blocked ({task.dependencyInfo?.pendingDeps} deps)
            </span>
          )}

          <span className="ml-auto flex items-center gap-1 text-xs text-neutral-400">
            P{task.priority}
          </span>

          {/* Action buttons */}
          <div className="flex items-center gap-1">
            {canMessage && (
              <button
                type="button"
                onClick={() => setMessageDialogOpen(true)}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                title="Send message to agent"
              >
                <MessageSquare className="size-3.5" />
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="rounded p-1 text-neutral-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 disabled:opacity-50"
                title="Cancel task"
              >
                <XCircle className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
          </div>
        </div>

        {/* Prompt (truncated) */}
        <div className="mt-1.5 text-sm text-neutral-700 dark:text-neutral-300 line-clamp-2">
          {task.prompt}
        </div>

        {/* Bottom row: metadata */}
        <div className="mt-1.5 flex items-center gap-3 text-xs text-neutral-400">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {createdAt}
          </span>
          {task.taskRunId && (
            <span className="flex items-center gap-1">
              <GitBranch className="size-3" />
              {String(task.taskRunId).slice(0, 12)}...
            </span>
          )}
          {hasDependencies && (
            <span className={isBlocked ? "text-amber-500" : "text-green-500"}>
              {task.dependencyInfo?.completedDeps}/{task.dependencyInfo?.totalDeps} deps complete
            </span>
          )}
        </div>

        {/* Error message if failed */}
        {hasError && (
          <div className="mt-2 flex items-start gap-1.5 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span className="line-clamp-2">{task.errorMessage}</span>
          </div>
        )}

        {/* Expanded details */}
        {expanded && (
          <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            {/* Full prompt */}
            <div>
              <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Full Prompt
              </div>
              <div className="mt-1 rounded bg-neutral-50 p-2 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                {task.prompt}
              </div>
            </div>

            {/* Result if completed */}
            {status === "completed" && task.result && (
              <div>
                <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  Result
                </div>
                <div className="mt-1 rounded bg-green-50 p-2 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-400">
                  {task.result}
                </div>
              </div>
            )}

            {/* Blocked by list */}
            {isBlocked && task.dependencyInfo?.blockedBy && task.dependencyInfo.blockedBy.length > 0 && (
              <div>
                <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  Blocked By
                </div>
                <div className="mt-1 space-y-1">
                  {task.dependencyInfo.blockedBy.map((dep) => (
                    <div
                      key={dep._id}
                      className="flex items-center gap-2 rounded bg-amber-50 px-2 py-1 text-xs dark:bg-amber-900/20"
                    >
                      <span className="text-amber-700 dark:text-amber-400">
                        {dep.status}
                      </span>
                      <span className="text-neutral-600 dark:text-neutral-400">
                        {dep.prompt}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              {task.startedAt && (
                <div>
                  <span className="text-neutral-500">Started:</span>{" "}
                  <span className="text-neutral-700 dark:text-neutral-300">
                    {new Date(task.startedAt).toLocaleString()}
                  </span>
                </div>
              )}
              {task.completedAt && (
                <div>
                  <span className="text-neutral-500">Completed:</span>{" "}
                  <span className="text-neutral-700 dark:text-neutral-300">
                    {new Date(task.completedAt).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Message Dialog */}
      {task.taskRunId && (
        <OrchestrationMessageDialog
          open={messageDialogOpen}
          onOpenChange={setMessageDialogOpen}
          teamSlugOrId={teamSlugOrId}
          taskRunId={task.taskRunId}
          agentName={task.assignedAgentName ?? "Agent"}
        />
      )}
    </>
  );
}
