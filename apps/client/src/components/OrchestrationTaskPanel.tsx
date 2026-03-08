import { useState } from "react";
import { useQuery, useConvex } from "convex/react";
import { Link } from "@tanstack/react-router";
import { api } from "@cmux/convex/api";
import {
  GitBranch,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Pause,
  Play,
  Users,
  AlertTriangle,
  ExternalLink,
  MessageSquare,
  XOctagon,
} from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { OrchestrationMessageDialog } from "./orchestration/OrchestrationMessageDialog";
import type { Id } from "@cmux/convex/dataModel";

export interface OrchestrationTaskPanelProps {
  teamSlugOrId: string;
}

type TaskStatus = "pending" | "assigned" | "running" | "completed" | "failed" | "cancelled";

const STATUS_CONFIG: Record<TaskStatus, { icon: React.ElementType; color: string; label: string }> = {
  pending: { icon: Clock, color: "text-neutral-500", label: "Pending" },
  assigned: { icon: Play, color: "text-blue-500", label: "Assigned" },
  running: { icon: Loader2, color: "text-blue-500", label: "Running" },
  completed: { icon: CheckCircle2, color: "text-green-500", label: "Completed" },
  failed: { icon: XCircle, color: "text-red-500", label: "Failed" },
  cancelled: { icon: Pause, color: "text-neutral-400", label: "Cancelled" },
};

export function OrchestrationTaskPanel({ teamSlugOrId }: OrchestrationTaskPanelProps) {
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<{
    taskRunId: Id<"taskRuns">;
    agentName: string;
  } | null>(null);
  const convex = useConvex();

  const tasks = useQuery(api.orchestrationQueries.listTasksByTeam, {
    teamSlugOrId,
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 50,
  });

  const handleCancelTask = async (taskId: Id<"orchestrationTasks">) => {
    try {
      await convex.mutation(api.orchestrationQueries.cancelTask, { taskId });
      toast.success("Task cancelled");
    } catch (error) {
      toast.error(`Failed to cancel: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleOpenMessage = (taskRunId: Id<"taskRuns">, agentName: string) => {
    setSelectedTask({ taskRunId, agentName });
    setMessageDialogOpen(true);
  };

  // Loading state
  if (tasks === undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-500 dark:text-neutral-400">
        <div className="size-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600 dark:border-neutral-600 dark:border-t-neutral-300" />
        <span className="text-sm">Loading orchestration tasks...</span>
      </div>
    );
  }

  // Empty state
  if (!tasks || tasks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-neutral-500 dark:text-neutral-400">
        <Users className="size-8 text-neutral-400 dark:text-neutral-500" />
        <div className="text-sm font-medium text-neutral-600 dark:text-neutral-200">
          No orchestration tasks
        </div>
        <p className="text-xs">
          Orchestration tasks will appear here when agents spawn sub-agents
        </p>
        <Link
          to="/$teamSlugOrId/orchestration"
          params={{ teamSlugOrId }}
          className="mt-2 inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600"
        >
          Open dashboard
          <ExternalLink className="size-3" />
        </Link>
      </div>
    );
  }

  // Count tasks by status
  const statusCounts = tasks.reduce(
    (acc, task) => {
      const status = task.status as TaskStatus;
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    {} as Record<TaskStatus, number>
  );

  const renderStatusBadge = (status: TaskStatus) => {
    const config = STATUS_CONFIG[status];
    const Icon = config.icon;
    return (
      <span
        className={clsx(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
          status === "running" && "bg-blue-100 dark:bg-blue-900/30",
          status === "completed" && "bg-green-100 dark:bg-green-900/30",
          status === "failed" && "bg-red-100 dark:bg-red-900/30",
          status === "pending" && "bg-neutral-100 dark:bg-neutral-800",
          status === "assigned" && "bg-blue-50 dark:bg-blue-900/20",
          status === "cancelled" && "bg-neutral-100 dark:bg-neutral-800"
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
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header with filters */}
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <Users className="size-4 text-neutral-500" />
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
          Orchestration Tasks
        </span>
        <span className="text-xs text-neutral-400">({tasks.length})</span>

        {/* Link to dashboard */}
        <Link
          to="/$teamSlugOrId/orchestration"
          params={{ teamSlugOrId }}
          className="ml-1 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          title="Open dashboard"
        >
          <ExternalLink className="size-3" />
        </Link>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "all")}
          className="ml-auto rounded border border-neutral-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800"
        >
          <option value="all">All statuses</option>
          {(Object.keys(STATUS_CONFIG) as TaskStatus[]).map((status) => (
            <option key={status} value={status}>
              {STATUS_CONFIG[status].label} ({statusCounts[status] || 0})
            </option>
          ))}
        </select>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-auto">
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {tasks.map((task) => {
            const status = task.status as TaskStatus;
            const createdAt = new Date(task.createdAt).toLocaleString();
            const hasError = status === "failed" && task.errorMessage;
            const canCancel = status === "pending" || status === "assigned";
            const canMessage = status === "running" && task.taskRunId;

            return (
              <div
                key={task._id}
                className={clsx(
                  "px-3 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50",
                  status === "running" && "bg-blue-50/50 dark:bg-blue-900/10"
                )}
              >
                {/* Top row: status + agent + actions */}
                <div className="flex items-center gap-2">
                  {renderStatusBadge(status)}
                  {task.assignedAgentName && (
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      {task.assignedAgentName}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-1 text-xs text-neutral-400">
                    P{task.priority}
                  </span>

                  {/* Action buttons */}
                  {canMessage && (
                    <button
                      type="button"
                      onClick={() => handleOpenMessage(task.taskRunId!, task.assignedAgentName ?? "Agent")}
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-blue-600 dark:hover:bg-neutral-800 dark:hover:text-blue-400"
                      title="Send message to agent"
                    >
                      <MessageSquare className="size-3" />
                    </button>
                  )}
                  {canCancel && (
                    <button
                      type="button"
                      onClick={() => handleCancelTask(task._id)}
                      className="rounded p-1 text-neutral-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                      title="Cancel task"
                    >
                      <XOctagon className="size-3" />
                    </button>
                  )}
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
                  {task.dependencies && task.dependencies.length > 0 && (
                    <span className="text-amber-500">
                      Depends on {task.dependencies.length} task(s)
                    </span>
                  )}
                </div>

                {/* Result if completed */}
                {status === "completed" && task.result && (
                  <div className="mt-2 rounded bg-green-50 px-2 py-1.5 text-xs text-green-700 line-clamp-2 dark:bg-green-900/20 dark:text-green-400">
                    {task.result}
                  </div>
                )}

                {/* Error message if failed */}
                {hasError && (
                  <div className="mt-2 flex items-start gap-1.5 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    <span className="line-clamp-2">{task.errorMessage}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Message Dialog */}
      {selectedTask && (
        <OrchestrationMessageDialog
          open={messageDialogOpen}
          onOpenChange={setMessageDialogOpen}
          teamSlugOrId={teamSlugOrId}
          taskRunId={selectedTask.taskRunId}
          agentName={selectedTask.agentName}
        />
      )}
    </div>
  );
}
