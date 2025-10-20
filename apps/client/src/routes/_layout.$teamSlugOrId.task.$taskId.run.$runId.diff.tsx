import { FloatingPane } from "@/components/floating-pane";
import { type GitDiffViewerProps } from "@/components/git-diff-viewer";
import { RunDiffSection } from "@/components/RunDiffSection";
import { TaskDetailHeader } from "@/components/task-detail-header";
import { useTheme } from "@/components/theme/use-theme";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { useSocket } from "@/contexts/socket/use-socket";
import { normalizeGitRef } from "@/lib/refWithOrigin";
import { cn } from "@/lib/utils";
import { gitDiffQueryOptions } from "@/queries/git-diff";
import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import type { TaskAcknowledged, TaskStarted, TaskError } from "@cmux/shared";
import { AGENT_CONFIGS } from "@cmux/shared/agentConfig";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { convexQuery } from "@convex-dev/react-query";
import { Switch } from "@heroui/react";
import { useQuery as useRQ } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  ChevronDown,
  ChevronRight,
  Check,
  Circle,
  Clock,
  Command,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";
import {
  Suspense,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import { toast } from "sonner";
import { attachTaskLifecycleListeners } from "@/lib/socket/taskLifecycleListeners";
import z from "zod";
import type { EditorApi } from "@/components/dashboard/DashboardInput";
import LexicalEditor from "@/components/lexical/LexicalEditor";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
});

const gitDiffViewerClassNames: GitDiffViewerProps["classNames"] = {
  fileDiffRow: {
    button: "top-[96px] md:top-[56px]",
  },
};

type DiffControls = Parameters<
  NonNullable<GitDiffViewerProps["onControlsChange"]>
>[0];

type RunEnvironmentSummary = Pick<
  Doc<"environments">,
  "_id" | "name" | "selectedRepos"
>;

type TaskRunWithChildren = Doc<"taskRuns"> & {
  children: TaskRunWithChildren[];
  environment: RunEnvironmentSummary | null;
};

const AVAILABLE_AGENT_NAMES = new Set(AGENT_CONFIGS.map((agent) => agent.name));

type WorkflowRunsProps = {
  teamSlugOrId: string;
  repoFullName: string;
  prNumber: number;
  headSha?: string;
};

type WorkflowRunRecord =
  (typeof api.github_workflows.getWorkflowRunsForPr._returnType)[number];
type CheckRunRecord =
  (typeof api.github_check_runs.getCheckRunsForPr._returnType)[number];
type DeploymentRecord =
  (typeof api.github_deployments.getDeploymentsForPr._returnType)[number];
type CommitStatusRecord =
  (typeof api.github_commit_statuses.getCommitStatusesForPr._returnType)[number];

type CombinedStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "pending"
  | "waiting"
  | undefined;

type CombinedConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | undefined;

type CombinedRun =
  | (WorkflowRunRecord & {
      type: "workflow";
      name: string;
      timestamp?: number;
      url?: string;
      status?: CombinedStatus;
      conclusion?: CombinedConclusion;
    })
  | (CheckRunRecord & {
      type: "check";
      name: string;
      timestamp?: number;
      url?: string;
      status?: CombinedStatus;
      conclusion?: CombinedConclusion;
    })
  | (DeploymentRecord & {
      type: "deployment";
      name: string;
      timestamp?: number;
      url?: string;
      status?: CombinedStatus;
      conclusion?: CombinedConclusion;
    })
  | (CommitStatusRecord & {
      type: "status";
      name: string;
      timestamp?: number;
      url?: string;
      status?: CombinedStatus;
      conclusion?: CombinedConclusion;
    });

type RunPullRequestForChecks = {
  repoFullName: string;
  number: number;
  url?: string;
  headShaHint?: string;
};

function useCombinedWorkflowData({
  teamSlugOrId,
  repoFullName,
  prNumber,
  headSha,
}: WorkflowRunsProps): { allRuns: CombinedRun[]; isLoading: boolean } {
  const shouldFetch = Boolean(teamSlugOrId && repoFullName && prNumber);

  const args = shouldFetch
    ? {
        teamSlugOrId,
        repoFullName,
        prNumber,
        headSha,
        limit: 50,
      }
    : "skip";

  const workflowRuns = useQuery(api.github_workflows.getWorkflowRunsForPr, args);
  const checkRuns = useQuery(api.github_check_runs.getCheckRunsForPr, args);
  const deployments = useQuery(api.github_deployments.getDeploymentsForPr, args);
  const commitStatuses = useQuery(
    api.github_commit_statuses.getCommitStatusesForPr,
    args,
  );

  const isLoading =
    shouldFetch &&
    (workflowRuns === undefined ||
      checkRuns === undefined ||
      deployments === undefined ||
      commitStatuses === undefined);

  const allRuns = useMemo<CombinedRun[]>(() => {
    if (!shouldFetch) {
      return [];
    }

    const workflowEntries: CombinedRun[] = (workflowRuns ?? []).map((run) => ({
      ...run,
      type: "workflow" as const,
      name: run.workflowName,
      timestamp: run.runStartedAt ?? undefined,
      url: run.htmlUrl ?? undefined,
      status: run.status ?? undefined,
      conclusion: run.conclusion ?? undefined,
    }));

    const checkEntries: CombinedRun[] = (checkRuns ?? []).map((run) => ({
      ...run,
      type: "check" as const,
      name: run.name,
      timestamp: run.startedAt ?? undefined,
      url: run.htmlUrl ?? undefined,
      status: run.status ?? undefined,
      conclusion: run.conclusion ?? undefined,
    }));

    const deploymentEntries: CombinedRun[] = (deployments ?? [])
      .filter((deployment) => deployment.environment !== "Preview")
      .map((deployment) => {
        const status: CombinedStatus = deployment.state === "pending"
          ? "pending"
          : deployment.state === "in_progress"
            ? "in_progress"
            : deployment.state === "queued"
              ? "queued"
              : "completed";
        const conclusion: CombinedConclusion = deployment.state === "success"
          ? "success"
          : deployment.state === "failure" || deployment.state === "error"
            ? "failure"
            : undefined;
        return {
          ...deployment,
          type: "deployment" as const,
          name:
            deployment.description || deployment.environment || "Deployment",
          timestamp: deployment.createdAt ?? undefined,
          url: deployment.targetUrl ?? deployment.logUrl ?? undefined,
          status,
          conclusion,
        } satisfies CombinedRun;
      });

    const statusEntries: CombinedRun[] = (commitStatuses ?? []).map((status) => {
      const mappedStatus: CombinedStatus =
        status.state === "pending" ? "pending" : "completed";
      const mappedConclusion: CombinedConclusion =
        status.state === "success"
          ? "success"
          : status.state === "failure"
            ? "failure"
            : status.state === "error"
              ? "failure"
              : undefined;
      return {
        ...status,
        type: "status" as const,
        name: status.context,
        timestamp: status.updatedAt ?? undefined,
        url: status.targetUrl ?? undefined,
        status: mappedStatus,
        conclusion: mappedConclusion,
      } satisfies CombinedRun;
    });

    return [
      ...workflowEntries,
      ...checkEntries,
      ...deploymentEntries,
      ...statusEntries,
    ];
  }, [checkRuns, commitStatuses, deployments, shouldFetch, workflowRuns]);

  return { allRuns, isLoading };
}

function deriveSummaryState(
  allRuns: CombinedRun[],
  isLoading: boolean,
): {
  icon: JSX.Element;
  colorClass: string;
  label: string;
  defaultExpanded: boolean;
} {
  if (isLoading) {
    return {
      icon: <Loader2 className="w-3 h-3 animate-spin text-neutral-500" />,
      colorClass: "text-neutral-500 dark:text-neutral-400",
      label: "Loading checks",
      defaultExpanded: false,
    };
  }

  if (allRuns.length === 0) {
    return {
      icon: <Circle className="w-3 h-3" />,
      colorClass: "text-neutral-500 dark:text-neutral-400",
      label: "No checks yet",
      defaultExpanded: false,
    };
  }

  const hasAnyRunning = allRuns.some((run) =>
    run.status === "in_progress" ||
    run.status === "pending" ||
    run.status === "queued" ||
    run.status === "waiting"
  );
  const hasAnyFailure = allRuns.some(
    (run) =>
      run.conclusion === "failure" ||
      run.conclusion === "timed_out" ||
      run.conclusion === "action_required",
  );
  const allPassed =
    allRuns.length > 0 &&
    allRuns.every(
      (run) =>
        run.conclusion === "success" ||
        run.conclusion === "neutral" ||
        run.conclusion === "skipped" ||
        run.conclusion === undefined,
    );

  if (hasAnyRunning) {
    return {
      icon: <Clock className="w-3 h-3 animate-pulse" />,
      colorClass: "text-yellow-600 dark:text-yellow-500",
      label: "Checks running",
      defaultExpanded: true,
    };
  }

  if (hasAnyFailure) {
    return {
      icon: <X className="w-3 h-3" />,
      colorClass: "text-red-600 dark:text-red-500",
      label: "Checks failed",
      defaultExpanded: true,
    };
  }

  if (allPassed) {
    return {
      icon: <Check className="w-3 h-3" />,
      colorClass: "text-green-600 dark:text-green-500",
      label: "All checks passed",
      defaultExpanded: false,
    };
  }

  return {
    icon: <Circle className="w-3 h-3" />,
    colorClass: "text-neutral-500 dark:text-neutral-400",
    label: `${allRuns.length} checks`,
    defaultExpanded: false,
  };
}

function formatTimeAgo(timestamp?: number): string {
  if (!timestamp) return "";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getStatusIcon(
  status: CombinedStatus,
  conclusion: CombinedConclusion,
): JSX.Element {
  if (conclusion === "success") {
    return (
      <Check className="w-3 h-3 text-green-600 dark:text-green-400" strokeWidth={2} />
    );
  }
  if (conclusion === "failure" || conclusion === "timed_out") {
    return <X className="w-3 h-3 text-red-600 dark:text-red-400" strokeWidth={2} />;
  }
  if (conclusion === "cancelled") {
    return (
      <Circle className="w-3 h-3 text-neutral-500 dark:text-neutral-400" strokeWidth={2} />
    );
  }
  if (
    status === "in_progress" ||
    status === "queued" ||
    status === "pending" ||
    status === "waiting"
  ) {
    return (
      <Loader2
        className="w-3 h-3 text-yellow-600 dark:text-yellow-500 animate-spin"
        strokeWidth={2}
      />
    );
  }
  return (
    <Circle className="w-3 h-3 text-neutral-500 dark:text-neutral-400" strokeWidth={2} />
  );
}

function describeRun(run: CombinedRun): string {
  const parts: string[] = [];

  if (run.conclusion === "success") {
    if (run.type === "workflow" && run.runDuration) {
      const mins = Math.floor(run.runDuration / 60);
      const secs = run.runDuration % 60;
      parts.push(`Successful in ${mins}m ${secs}s`);
    } else {
      parts.push("Successful");
    }
  } else if (run.conclusion === "failure") {
    parts.push("Failed");
  } else if (run.conclusion === "cancelled") {
    parts.push("Cancelled");
  } else if (run.conclusion === "skipped") {
    parts.push("Skipped");
  } else if (run.conclusion === "timed_out") {
    parts.push("Timed out");
  } else if (run.conclusion === "action_required") {
    parts.push("Action required");
  } else if (run.conclusion === "neutral") {
    parts.push("Neutral");
  } else if (
    run.status === "in_progress" ||
    run.status === "pending" ||
    run.status === "waiting"
  ) {
    parts.push("In progress");
  } else if (run.status === "queued") {
    parts.push("Queued");
  }

  const timeAgo = formatTimeAgo(run.timestamp);
  if (timeAgo) {
    parts.push(timeAgo);
  }

  return parts.join(" — ");
}

interface TaskRunPullRequestChecksProps {
  teamSlugOrId: string;
  repoFullName: string;
  prNumber: number;
  pullRequestUrl?: string;
  headShaHint?: string;
}

const TaskRunPullRequestChecks = memo(function TaskRunPullRequestChecks({
  teamSlugOrId,
  repoFullName,
  prNumber,
  pullRequestUrl,
  headShaHint,
}: TaskRunPullRequestChecksProps) {
  const prDoc = useQuery(
    api.github_prs.getPullRequest,
    prNumber > 0 && repoFullName
      ? {
          teamSlugOrId,
          repoFullName,
          number: prNumber,
        }
      : "skip",
  );

  const { allRuns, isLoading } = useCombinedWorkflowData({
    teamSlugOrId,
    repoFullName,
    prNumber,
    headSha: prDoc?.headSha ?? headShaHint,
  });

  const summary = useMemo(
    () => deriveSummaryState(allRuns, isLoading),
    [allRuns, isLoading],
  );

  const [isExpanded, setIsExpanded] = useState(summary.defaultExpanded);

  useEffect(() => {
    if (summary.defaultExpanded) {
      setIsExpanded(true);
    }
  }, [summary.defaultExpanded]);

  const sortedRuns = useMemo(() => {
    const priority = (run: CombinedRun): number => {
      if (run.conclusion === "failure" || run.conclusion === "timed_out" || run.conclusion === "action_required") return 0;
      if (run.status === "in_progress" || run.status === "queued" || run.status === "waiting" || run.status === "pending") return 1;
      if (run.conclusion === "success" || run.conclusion === "neutral" || run.conclusion === "skipped") return 2;
      if (run.conclusion === "cancelled") return 3;
      return 4;
    };

    return [...allRuns].sort((a, b) => {
      const priorityDiff = priority(a) - priority(b);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return (b.timestamp ?? 0) - (a.timestamp ?? 0);
    });
  }, [allRuns]);

  const headerDescription = useMemo(() => {
    if (allRuns.length === 0 && !isLoading) {
      return "Waiting for checks";
    }
    if (summary.label === "Loading checks") {
      return summary.label;
    }
    return summary.label;
  }, [allRuns.length, isLoading, summary.label]);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950/40">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 ${summary.colorClass}`}>
            {summary.icon}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
              {repoFullName}#{prNumber}
            </div>
            <div className={`text-[11px] ${summary.colorClass} truncate`}>{headerDescription}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pullRequestUrl && (
            <a
              href={pullRequestUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline dark:text-blue-400"
            >
              Open PR
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded((value) => !value)}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse checks" : "Expand checks"}
          >
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {isExpanded ? (
        isLoading ? (
          <div className="px-3 py-3 text-sm text-neutral-500 dark:text-neutral-400">
            Loading checks…
          </div>
        ) : sortedRuns.length === 0 ? (
          <div className="px-3 py-3 text-sm text-neutral-500 dark:text-neutral-400">
            No checks reported yet.
          </div>
        ) : (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {sortedRuns.map((run) => {
              const appLabel =
                run.type === "check" && "appSlug" in run && run.appSlug
                  ? `[${run.appSlug}]`
                  : run.type === "check" && "appName" in run && run.appName
                    ? `[${run.appName}]`
                    : run.type === "deployment"
                      ? "[deployment]"
                      : run.type === "status"
                        ? "[status]"
                        : null;

              const description = describeRun(run);

              return (
                <a
                  key={`${run.type}-${run._id}`}
                  href={run.url || "#"}
                  target={run.url ? "_blank" : undefined}
                  rel={run.url ? "noreferrer" : undefined}
                  className={cn(
                    "flex items-center justify-between gap-2 px-3 py-2 transition-colors",
                    run.url
                      ? "hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                      : "cursor-default",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="shrink-0">
                      {getStatusIcon(run.status, run.conclusion)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 text-[11px] font-medium text-neutral-900 dark:text-neutral-100">
                        <span className="truncate">{run.name}</span>
                        {appLabel && (
                          <span className="shrink-0 text-[10px] text-neutral-500 dark:text-neutral-500">
                            {appLabel}
                          </span>
                        )}
                      </div>
                      {description && (
                        <div className="text-[11px] text-neutral-600 dark:text-neutral-400">
                          {description}
                        </div>
                      )}
                    </div>
                  </div>
                  {run.url && (
                    <div className="shrink-0 text-neutral-500 dark:text-neutral-400">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </div>
                  )}
                </a>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
});

interface RestartTaskFormProps {
  task: Doc<"tasks"> | null | undefined;
  teamSlugOrId: string;
  restartAgents: string[];
  restartIsCloudMode: boolean;
  persistenceKey: string;
}

const RestartTaskForm = memo(function RestartTaskForm({
  task,
  teamSlugOrId,
  restartAgents,
  restartIsCloudMode,
  persistenceKey,
}: RestartTaskFormProps) {
  const { socket } = useSocket();
  const { theme } = useTheme();
  const { addTaskToExpand } = useExpandTasks();
  const createTask = useMutation(api.tasks.create);
  const editorApiRef = useRef<EditorApi | null>(null);
  const [followUpText, setFollowUpText] = useState("");
  const [isRestartingTask, setIsRestartingTask] = useState(false);
  const [overridePrompt, setOverridePrompt] = useState(false);

  const handleRestartTask = useCallback(async () => {
    if (!task) {
      toast.error("Task data is still loading. Try again in a moment.");
      return;
    }
    if (!socket) {
      toast.error("Socket not connected. Refresh or try again later.");
      return;
    }

    const editorContent = editorApiRef.current?.getContent();
    const followUp = (editorContent?.text ?? followUpText).trim();

    if (!followUp && overridePrompt) {
      toast.error("Add new instructions when overriding the prompt.");
      return;
    }
    if (!followUp && !task.text) {
      toast.error("Add follow-up context before restarting.");
      return;
    }

    if (restartAgents.length === 0) {
      toast.error(
        "No previous agents found for this task. Start a new run from the dashboard.",
      );
      return;
    }

    const originalPrompt = task.text ?? "";
    const combinedPrompt = overridePrompt
      ? followUp
      : originalPrompt
        ? followUp
          ? `${originalPrompt}\n\n${followUp}`
          : originalPrompt
        : followUp;

    const projectFullNameForSocket =
      task.projectFullName ??
      (task.environmentId ? `env:${task.environmentId}` : undefined);

    if (!projectFullNameForSocket) {
      toast.error("Missing repository or environment for this task.");
      return;
    }

    setIsRestartingTask(true);

    try {
      const existingImages =
        task.images && task.images.length > 0
          ? task.images.map((image) => ({
            storageId: image.storageId,
            fileName: image.fileName,
            altText: image.altText,
          }))
          : [];

      const newImages = (editorContent?.images && editorContent.images.length > 0
        ? editorContent.images.filter((img) => "storageId" in img)
        : []) as {
          storageId: Id<"_storage">;
          fileName: string | undefined;
          altText: string;
        }[];

      const imagesPayload =
        [...existingImages, ...newImages].length > 0
          ? [...existingImages, ...newImages]
          : undefined;

      const newTaskId = await createTask({
        teamSlugOrId,
        text: combinedPrompt,
        projectFullName: task.projectFullName ?? undefined,
        baseBranch: task.baseBranch ?? undefined,
        images: imagesPayload,
        environmentId: task.environmentId ?? undefined,
      });

      addTaskToExpand(newTaskId);

      const isEnvTask = projectFullNameForSocket.startsWith("env:");
      const repoUrl = !isEnvTask
        ? `https://github.com/${projectFullNameForSocket}.git`
        : undefined;

      const handleRestartAck = (response: TaskAcknowledged | TaskStarted | TaskError) => {
        if ("error" in response) {
          toast.error(`Task restart error: ${response.error}`);
          return;
        }

        attachTaskLifecycleListeners(socket, response.taskId, {
          onFailed: (payload) => {
            toast.error(`Follow-up task failed to start: ${payload.error}`);
          },
        });

        editorApiRef.current?.clear();
        setFollowUpText("");
      };

      socket.emit(
        "start-task",
        {
          ...(repoUrl ? { repoUrl } : {}),
          ...(task.baseBranch ? { branch: task.baseBranch } : {}),
          taskDescription: combinedPrompt,
          projectFullName: projectFullNameForSocket,
          taskId: newTaskId,
          selectedAgents: [...restartAgents],
          isCloudMode: restartIsCloudMode,
          ...(task.environmentId ? { environmentId: task.environmentId } : {}),
          theme,
        },
        handleRestartAck,
      );

      toast.success("Started follow-up task");
    } catch (error) {
      console.error("Failed to restart task", error);
      toast.error("Failed to start follow-up task");
    } finally {
      setIsRestartingTask(false);
    }
  }, [
    addTaskToExpand,
    createTask,
    followUpText,
    overridePrompt,
    restartAgents,
    restartIsCloudMode,
    socket,
    task,
    teamSlugOrId,
    theme,
  ]);

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void handleRestartTask();
    },
    [handleRestartTask],
  );

  const trimmedFollowUp = followUpText.trim();
  const isRestartDisabled =
    isRestartingTask ||
    (overridePrompt ? !trimmedFollowUp : !trimmedFollowUp && !task?.text) ||
    !socket ||
    !task;
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toUpperCase().includes("MAC");
  const restartDisabledReason = useMemo(() => {
    if (isRestartingTask) {
      return "Starting follow-up...";
    }
    if (!task) {
      return "Task data loading...";
    }
    if (!socket) {
      return "Socket not connected";
    }
    if (overridePrompt && !trimmedFollowUp) {
      return "Add new instructions";
    }
    if (!trimmedFollowUp && !task?.text) {
      return "Add follow-up context";
    }
    return undefined;
  }, [isRestartingTask, overridePrompt, socket, task, trimmedFollowUp]);

  return (
    <div className="sticky bottom-0 z-[var(--z-popover)] border-t border-transparent px-3.5 pb-3.5 pt-2">
      <form
        onSubmit={handleFormSubmit}
        className="mx-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-neutral-500/15 bg-white dark:border-neutral-500/15 dark:bg-neutral-950"
      >
        <div className="px-3.5 pt-3.5">
          <LexicalEditor
            key={persistenceKey}
            placeholder={
              overridePrompt
                ? "Edit original task instructions..."
                : "Add updated instructions or context..."
            }
            onChange={setFollowUpText}
            onSubmit={() => void handleRestartTask()}
            repoUrl={
              task?.projectFullName
                ? `https://github.com/${task.projectFullName}.git`
                : undefined
            }
            branch={task?.baseBranch ?? undefined}
            environmentId={task?.environmentId ?? undefined}
            persistenceKey={persistenceKey}
            maxHeight="300px"
            minHeight="30px"
            onEditorReady={(api) => {
              editorApiRef.current = api;
            }}
            contentEditableClassName="text-[15px] text-neutral-900 dark:text-neutral-100 focus:outline-none"
            padding={{
              paddingLeft: "0px",
              paddingRight: "0px",
              paddingTop: "0px",
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-3.5 pb-3 pt-2">
          <div className="flex items-center gap-2.5">
            <Switch
              isSelected={overridePrompt}
              onValueChange={(value) => {
                setOverridePrompt(value);
                if (value) {
                  if (!task?.text) {
                    return;
                  }
                  const promptText = task.text;
                  const currentContent = editorApiRef.current?.getContent();
                  const currentText = currentContent?.text ?? "";
                  if (!currentText) {
                    editorApiRef.current?.insertText?.(promptText);
                  } else if (!currentText.includes(promptText)) {
                    editorApiRef.current?.insertText?.(promptText);
                  }
                } else {
                  editorApiRef.current?.clear();
                }
              }}
              size="sm"
              aria-label="Override prompt"
              classNames={{
                wrapper: cn(
                  "group-data-[selected=true]:bg-neutral-600",
                  "group-data-[selected=true]:border-neutral-600",
                  "dark:group-data-[selected=true]:bg-neutral-500",
                  "dark:group-data-[selected=true]:border-neutral-500",
                ),
              }}
            />
            <span className="text-xs leading-tight text-neutral-500 dark:text-neutral-400">
              {overridePrompt
                ? "Override initial prompt"
                : task?.text
                  ? "Original prompt included"
                  : "New task prompt"}
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex">
                <Button
                  type="submit"
                  size="sm"
                  variant="default"
                  className="!h-7"
                  disabled={isRestartDisabled}
                >
                  {isRestartingTask ? "Starting..." : "Restart task"}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="flex items-center gap-1 border-black bg-black text-white [&>*:last-child]:bg-black [&>*:last-child]:fill-black"
            >
              {restartDisabledReason ? (
                <span className="text-xs">{restartDisabledReason}</span>
              ) : (
                <>
                  {isMac ? (
                    <>
                      <Command className="size-3.5 opacity-80" />
                      <span className="text-xs leading-tight">+ Enter</span>
                    </>
                  ) : (
                    <span className="text-xs leading-tight">Ctrl + Enter</span>
                  )}
                </>
              )}
            </TooltipContent>
          </Tooltip>
        </div>
      </form>
    </div>
  );
});

RestartTaskForm.displayName = "RestartTaskForm";

function collectAgentNamesFromRuns(
  runs: TaskRunWithChildren[] | undefined,
): string[] {
  if (!runs) return [];

  // Top-level runs mirror the user's original agent selection, including duplicates.
  const rootAgents = runs
    .map((run) => run.agentName?.trim())
    .filter((name): name is string => {
      if (!name) {
        return false;
      }
      return AVAILABLE_AGENT_NAMES.has(name);
    });

  if (rootAgents.length > 0) {
    return rootAgents;
  }

  const ordered: string[] = [];
  const traverse = (items: TaskRunWithChildren[]) => {
    for (const run of items) {
      const trimmed = run.agentName?.trim();
      if (trimmed && AVAILABLE_AGENT_NAMES.has(trimmed)) {
        ordered.push(trimmed);
      }
      if (run.children.length > 0) {
        traverse(run.children);
      }
    }
  };

  traverse(runs);
  return ordered;
}

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/diff",
)({
  component: RunDiffPage,
  params: {
    parse: paramsSchema.parse,
    stringify: (params) => {
      return {
        taskId: params.taskId,
        runId: params.runId,
      };
    },
  },
  loader: (opts) => {
    const { runId } = opts.params;

    void opts.context.queryClient
      .ensureQueryData(
        convexQuery(api.taskRuns.getRunDiffContext, {
          teamSlugOrId: opts.params.teamSlugOrId,
          taskId: opts.params.taskId,
          runId,
        }),
      )
      .then(async (context) => {
        if (!context) {
          return;
        }

        const { task, taskRuns, branchMetadataByRepo } = context;

        if (task) {
          opts.context.queryClient.setQueryData(
            convexQuery(api.tasks.getById, {
              teamSlugOrId: opts.params.teamSlugOrId,
              id: opts.params.taskId,
            }).queryKey,
            task,
          );
        }

        if (taskRuns) {
          opts.context.queryClient.setQueryData(
            convexQuery(api.taskRuns.getByTask, {
              teamSlugOrId: opts.params.teamSlugOrId,
              taskId: opts.params.taskId,
            }).queryKey,
            taskRuns,
          );
        }

        const selectedTaskRun = taskRuns.find((run) => run._id === runId);
        if (!task || !selectedTaskRun?.newBranch) {
          return;
        }

        const trimmedProjectFullName = task.projectFullName?.trim();
        const targetRepos = new Set<string>();
        for (const repo of selectedTaskRun.environment?.selectedRepos ?? []) {
          const trimmed = repo?.trim();
          if (trimmed) {
            targetRepos.add(trimmed);
          }
        }
        if (trimmedProjectFullName) {
          targetRepos.add(trimmedProjectFullName);
        }

        if (targetRepos.size === 0) {
          return;
        }

        const baseRefForDiff = normalizeGitRef(task.baseBranch || "main");
        const headRefForDiff = normalizeGitRef(selectedTaskRun.newBranch);
        if (!headRefForDiff || !baseRefForDiff) {
          return;
        }

        const metadataForPrimaryRepo = trimmedProjectFullName
          ? branchMetadataByRepo?.[trimmedProjectFullName]
          : undefined;
        const baseBranchMeta = metadataForPrimaryRepo?.find(
          (branch) => branch.name === task.baseBranch,
        );

        const prefetches = Array.from(targetRepos).map(async (repoFullName) => {
          const metadata =
            trimmedProjectFullName && repoFullName === trimmedProjectFullName
              ? baseBranchMeta
              : undefined;

          return opts.context.queryClient
            .ensureQueryData(
              gitDiffQueryOptions({
                baseRef: baseRefForDiff,
                headRef: headRefForDiff,
                repoFullName,
                lastKnownBaseSha: metadata?.lastKnownBaseSha,
                lastKnownMergeCommitSha: metadata?.lastKnownMergeCommitSha,
              }),
            )
            .catch(() => undefined);
        });

        await Promise.all(prefetches);
      })
      .catch(() => undefined);

    return undefined;
  },
});

function RunDiffPage() {
  const { taskId, teamSlugOrId, runId } = Route.useParams();
  const [diffControls, setDiffControls] = useState<DiffControls | null>(null);
  const task = useQuery(api.tasks.getById, {
    teamSlugOrId,
    id: taskId,
  });
  const taskRuns = useQuery(api.taskRuns.getByTask, {
    teamSlugOrId,
    taskId,
  });
  const selectedRun = useMemo(() => {
    return taskRuns?.find((run) => run._id === runId);
  }, [runId, taskRuns]);
  const restartProvider = selectedRun?.vscode?.provider;
  const restartRunEnvironmentId = selectedRun?.environmentId;
  const taskEnvironmentId = task?.environmentId;
  const restartIsCloudMode = useMemo(() => {
    if (restartProvider === "docker") {
      return false;
    }
    if (restartProvider) {
      return true;
    }
    if (restartRunEnvironmentId || taskEnvironmentId) {
      return true;
    }
    return false;
  }, [restartProvider, restartRunEnvironmentId, taskEnvironmentId]);
  const environmentRepos = useMemo(() => {
    const repos = selectedRun?.environment?.selectedRepos ?? [];
    const trimmed = repos
      .map((repo) => repo?.trim())
      .filter((repo): repo is string => Boolean(repo));
    return Array.from(new Set(trimmed));
  }, [selectedRun]);

  const repoFullNames = useMemo(() => {
    if (task?.projectFullName) {
      return [task.projectFullName];
    }
    return environmentRepos;
  }, [task?.projectFullName, environmentRepos]);

  const [primaryRepo, ...additionalRepos] = repoFullNames;

  const aggregatedPullRequestUrl = useMemo(() => {
    const url = selectedRun?.pullRequestUrl;
    if (!url || url === "pending") {
      return undefined;
    }
    return url;
  }, [selectedRun?.pullRequestUrl]);

  const runPullRequests = useMemo<RunPullRequestForChecks[]>(() => {
    const explicit = selectedRun?.pullRequests ?? [];
    const normalized: RunPullRequestForChecks[] = [];

    for (const pr of explicit) {
      const repoName = pr.repoFullName?.trim();
      const prNumber = pr.number ?? selectedRun?.pullRequestNumber ?? undefined;
      if (!repoName || !prNumber) {
        continue;
      }
      normalized.push({
        repoFullName: repoName,
        number: prNumber,
        url: pr.url ?? aggregatedPullRequestUrl,
      });
    }

    if (normalized.length > 0) {
      const uniqueByRepo = new Map<string, RunPullRequestForChecks>();
      for (const pr of normalized) {
        if (!uniqueByRepo.has(pr.repoFullName)) {
          uniqueByRepo.set(pr.repoFullName, pr);
        }
      }
      return Array.from(uniqueByRepo.values());
    }

    if (selectedRun?.pullRequestNumber) {
      const fallbackRepo = primaryRepo ?? environmentRepos[0];
      if (!fallbackRepo) {
        return [];
      }
      return [
        {
          repoFullName: fallbackRepo,
          number: selectedRun.pullRequestNumber,
          url: aggregatedPullRequestUrl,
        },
      ];
    }

    return [];
  }, [aggregatedPullRequestUrl, environmentRepos, primaryRepo, selectedRun]);

  const branchMetadataQuery = useRQ({
    ...convexQuery(api.github.getBranchesByRepo, {
      teamSlugOrId,
      repo: primaryRepo ?? "",
    }),
    enabled: Boolean(primaryRepo),
  });

  const branchMetadata = branchMetadataQuery.data as
    | Doc<"branches">[]
    | undefined;

  const baseBranchMetadata = useMemo(() => {
    if (!task?.baseBranch) {
      return undefined;
    }
    return branchMetadata?.find((branch) => branch.name === task.baseBranch);
  }, [branchMetadata, task?.baseBranch]);

  const metadataByRepo = useMemo(() => {
    if (!primaryRepo) return undefined;
    if (!baseBranchMetadata) return undefined;
    const { lastKnownBaseSha, lastKnownMergeCommitSha } = baseBranchMetadata;
    if (!lastKnownBaseSha && !lastKnownMergeCommitSha) {
      return undefined;
    }
    return {
      [primaryRepo]: {
        lastKnownBaseSha: lastKnownBaseSha ?? undefined,
        lastKnownMergeCommitSha: lastKnownMergeCommitSha ?? undefined,
      },
    };
  }, [primaryRepo, baseBranchMetadata]);

  const restartAgents = useMemo(() => {
    const previousAgents = collectAgentNamesFromRuns(taskRuns);
    if (previousAgents.length > 0) {
      return previousAgents;
    }
    const fallback = selectedRun?.agentName?.trim();
    if (fallback && AVAILABLE_AGENT_NAMES.has(fallback)) {
      return [fallback];
    }
    return [];
  }, [selectedRun?.agentName, taskRuns]);

  const taskRunId = selectedRun?._id ?? runId;
  const restartTaskPersistenceKey = `restart-task-${taskId}-${runId}`;

  // 404 if selected run is missing
  if (!selectedRun) {
    return (
      <div className="p-6 text-sm text-neutral-600 dark:text-neutral-300">
        404 – Run not found
      </div>
    );
  }

  const baseRef = normalizeGitRef(task?.baseBranch || "main");
  const headRef = normalizeGitRef(selectedRun.newBranch);
  const hasDiffSources =
    Boolean(primaryRepo) && Boolean(baseRef) && Boolean(headRef);
  const shouldPrefixDiffs = repoFullNames.length > 1;

  return (
    <FloatingPane>
      <div className="flex h-full min-h-0 flex-col relative isolate">
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          <TaskDetailHeader
            task={task}
            taskRuns={taskRuns ?? null}
            selectedRun={selectedRun ?? null}
            taskRunId={taskRunId}
            onExpandAll={diffControls?.expandAll}
            onCollapseAll={diffControls?.collapseAll}
            teamSlugOrId={teamSlugOrId}
          />
          {task?.text && (
            <div className="mb-2 px-3.5">
              <div className="text-xs text-neutral-600 dark:text-neutral-300">
                <span className="text-neutral-500 dark:text-neutral-400 select-none">
                  Prompt:{" "}
                </span>
                <span className="font-medium">{task.text}</span>
              </div>
            </div>
          )}
          <div className="bg-white dark:bg-neutral-900 grow flex flex-col">
            {runPullRequests.length > 0 && (
              <div className="px-3.5 pt-3 pb-2 shrink-0 space-y-2">
                <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                  Checks & statuses
                </div>
                <div className="space-y-2">
                  {runPullRequests.map((pr) => (
                    <TaskRunPullRequestChecks
                      key={`${pr.repoFullName}-${pr.number}`}
                      teamSlugOrId={teamSlugOrId}
                      repoFullName={pr.repoFullName}
                      prNumber={pr.number}
                      pullRequestUrl={pr.url}
                      headShaHint={pr.headShaHint}
                    />
                  ))}
                </div>
              </div>
            )}
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full">
                  <div className="text-neutral-500 dark:text-neutral-400 text-sm select-none">
                    Loading diffs...
                  </div>
                </div>
              }
            >
              {hasDiffSources ? (
                <RunDiffSection
                  repoFullName={primaryRepo as string}
                  additionalRepoFullNames={additionalRepos}
                  withRepoPrefix={shouldPrefixDiffs}
                  ref1={baseRef}
                  ref2={headRef}
                  onControlsChange={setDiffControls}
                  classNames={gitDiffViewerClassNames}
                  metadataByRepo={metadataByRepo}
                />
              ) : (
                <div className="p-6 text-sm text-neutral-600 dark:text-neutral-300">
                  Missing repo or branches to show diff.
                </div>
              )}
            </Suspense>
            <RestartTaskForm
              key={restartTaskPersistenceKey}
              task={task}
              teamSlugOrId={teamSlugOrId}
              restartAgents={restartAgents}
              restartIsCloudMode={restartIsCloudMode}
              persistenceKey={restartTaskPersistenceKey}
            />
          </div>
        </div>
      </div>
    </FloatingPane>
  );
}
