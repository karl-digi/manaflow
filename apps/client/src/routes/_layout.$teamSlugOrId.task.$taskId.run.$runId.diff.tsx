import { FloatingPane } from "@/components/floating-pane";
import { type GitDiffViewerProps } from "@/components/git-diff-viewer";
import { RunDiffSection } from "@/components/RunDiffSection";
import { RunScreenshotGallery } from "@/components/RunScreenshotGallery";
import { TaskDetailHeader } from "@/components/task-detail-header";
import { useSocket } from "@/contexts/socket/use-socket";
import { normalizeGitRef } from "@/lib/refWithOrigin";
import { gitDiffQueryOptions } from "@/queries/git-diff";
import { parseReviewHeatmap, type ReviewHeatmapLine } from "@/lib/heatmap";
import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import type { CreateLocalWorkspaceResponse } from "@cmux/shared";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery as useRQ, useMutation as useRQMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import z from "zod";
import { useCombinedWorkflowData, WorkflowRunsSection } from "@/components/WorkflowRunsSection";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import { postApiCodeReviewStartMutation } from "@cmux/www-openapi-client/react-query";
import { Button } from "@/components/ui/button";

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

function WorkflowRunsWrapper({
  teamSlugOrId,
  repoFullName,
  prNumber,
  headSha,
  checksExpandedByRepo,
  setChecksExpandedByRepo,
}: {
  teamSlugOrId: string;
  repoFullName: string;
  prNumber: number;
  headSha?: string;
  checksExpandedByRepo: Record<string, boolean | null>;
  setChecksExpandedByRepo: React.Dispatch<React.SetStateAction<Record<string, boolean | null>>>;
}) {
  const workflowData = useCombinedWorkflowData({
    teamSlugOrId,
    repoFullName,
    prNumber,
    headSha,
  });

  // Auto-expand if there are failures (only on initial load)
  const hasAnyFailure = useMemo(() => {
    return workflowData.allRuns.some(
      (run) =>
        run.conclusion === "failure" ||
        run.conclusion === "timed_out" ||
        run.conclusion === "action_required"
    );
  }, [workflowData.allRuns]);

  const isExpanded = checksExpandedByRepo[repoFullName] ?? hasAnyFailure;

  return (
    <WorkflowRunsSection
      allRuns={workflowData.allRuns}
      isLoading={workflowData.isLoading}
      isExpanded={isExpanded}
      onToggle={() => {
        setChecksExpandedByRepo((prev) => ({
          ...prev,
          [repoFullName]: !isExpanded,
        }));
      }}
    />
  );
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

    convexQueryClient.convexClient.prewarmQuery({
      query: api.taskRuns.getRunDiffContext,
      args: { teamSlugOrId: opts.params.teamSlugOrId, taskId: opts.params.taskId, runId },
    });

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
  const { socket } = useSocket();
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

  // Heatmap review state - automatically fetched via streaming Convex subscription
  const [heatmapByFile, setHeatmapByFile] = useState<Map<string, ReviewHeatmapLine[]> | undefined>(undefined);
  const [heatmapJobStarted, setHeatmapJobStarted] = useState(false);
  const [comparisonSlug, setComparisonSlug] = useState<string | null>(null);

  // Query workspace settings for heatmap threshold
  const workspaceSettingsQuery = useRQ({
    ...convexQuery(api.workspaceSettings.get, { teamSlugOrId }),
    enabled: Boolean(teamSlugOrId),
  });
  const workspaceSettings = workspaceSettingsQuery.data as {
    heatmapThreshold?: number;
  } | null | undefined;
  const heatmapThreshold = workspaceSettings?.heatmapThreshold ?? 0;

  // Code review mutation to start the heatmap job
  const codeReviewMutation = useRQMutation({
    ...postApiCodeReviewStartMutation(),
    onSuccess: (data) => {
      console.log("[heatmap] Mutation success", {
        jobId: data.job?.jobId,
        state: data.job?.state,
        comparisonSlug: data.job?.comparisonSlug,
        hasCodeReviewOutput: Boolean(data.job?.codeReviewOutput),
      });

      // Store comparison slug for subscription
      if (data.job?.comparisonSlug) {
        setComparisonSlug(data.job.comparisonSlug);
      }
      // Check if we already have output (from a completed deduplicated job)
      // The codeReviewOutput shape is: { strategy, reviewType, files: Array<{ filePath, lines }>, ... }
      const reviewOutput = data.job?.codeReviewOutput;
      if (reviewOutput && typeof reviewOutput === "object") {
        console.log("[heatmap] Processing codeReviewOutput from completed job", reviewOutput);
        const heatmapData = new Map<string, ReviewHeatmapLine[]>();
        const files = (reviewOutput as { files?: unknown }).files;
        if (Array.isArray(files)) {
          console.log("[heatmap] Found files array with", files.length, "entries");
          for (const fileEntry of files) {
            if (typeof fileEntry === "object" && fileEntry !== null) {
              const filePath = (fileEntry as { filePath?: unknown }).filePath;
              if (typeof filePath === "string") {
                const parsed = parseReviewHeatmap(fileEntry);
                console.log("[heatmap] Parsed", filePath, "got", parsed.length, "lines");
                if (parsed.length > 0) {
                  heatmapData.set(filePath, parsed);
                }
              }
            }
          }
        } else {
          console.log("[heatmap] No files array found in codeReviewOutput");
        }
        if (heatmapData.size > 0) {
          console.log("[heatmap] Setting heatmapByFile with", heatmapData.size, "files");
          setHeatmapByFile(heatmapData);
        }
      }
    },
    onError: (error) => {
      console.error("[heatmap] Mutation failed:", error);
    },
  });

  const runDiffContextQuery = useRQ({
    ...convexQuery(api.taskRuns.getRunDiffContext, {
      teamSlugOrId,
      taskId,
      runId,
    }),
    enabled: Boolean(teamSlugOrId && taskId && runId),
  });

  const screenshotSets = runDiffContextQuery.data?.screenshotSets ?? [];
  const screenshotSetsLoading =
    runDiffContextQuery.isLoading && screenshotSets.length === 0;

  // Get PR information from the selected run
  const pullRequests = useMemo(() => {
    return selectedRun?.pullRequests?.filter(
      (pr) => pr.number !== undefined && pr.number !== null
    ) as Array<{ repoFullName: string; number: number; url?: string }> | undefined;
  }, [selectedRun]);

  // Track expanded state for each PR's checks
  const [checksExpandedByRepo, setChecksExpandedByRepo] = useState<Record<string, boolean | null>>({});

  const expandAllChecks = useCallback(() => {
    if (!pullRequests) return;
    const newState: Record<string, boolean | null> = {};
    for (const pr of pullRequests) {
      newState[pr.repoFullName] = true;
    }
    setChecksExpandedByRepo(newState);
  }, [pullRequests]);

  const collapseAllChecks = useCallback(() => {
    if (!pullRequests) return;
    const newState: Record<string, boolean | null> = {};
    for (const pr of pullRequests) {
      newState[pr.repoFullName] = false;
    }
    setChecksExpandedByRepo(newState);
  }, [pullRequests]);

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

  // Subscribe to streaming file outputs from Convex
  const fileOutputs = useQuery(
    api.codeReview.listFileOutputsForComparison,
    comparisonSlug && primaryRepo
      ? {
          teamSlugOrId,
          repoFullName: primaryRepo,
          comparisonSlug,
        }
      : "skip"
  );

  // Update heatmap as file outputs stream in
  // Using a ref to track previous file count to avoid unnecessary re-renders
  const prevFileOutputsLengthRef = useRef(0);
  useEffect(() => {
    const currentLength = fileOutputs?.length ?? 0;
    // Only process if we have new files
    if (currentLength === 0 || currentLength === prevFileOutputsLengthRef.current) {
      return;
    }
    prevFileOutputsLengthRef.current = currentLength;

    console.log("[heatmap] fileOutputs update", { count: currentLength });

    const heatmapData = new Map<string, ReviewHeatmapLine[]>();
    if (fileOutputs) {
      for (const output of fileOutputs) {
        const parsed = parseReviewHeatmap(output.codexReviewOutput);
        if (parsed.length > 0) {
          heatmapData.set(output.filePath, parsed);
        }
      }
    }
    if (heatmapData.size > 0) {
      setHeatmapByFile(heatmapData);
    }
  }, [fileOutputs]);

  const taskRunId = selectedRun?._id ?? runId;

  const navigate = useNavigate();

  const handleOpenLocalWorkspace = useCallback(() => {
    if (!socket) {
      toast.error("Socket not connected");
      return;
    }

    if (!primaryRepo) {
      toast.error("No repository information available");
      return;
    }

    if (!selectedRun?.newBranch) {
      toast.error("No branch information available");
      return;
    }

    const loadingToast = toast.loading("Creating local workspace...");

    socket.emit(
      "create-local-workspace",
      {
        teamSlugOrId,
        projectFullName: primaryRepo,
        repoUrl: `https://github.com/${primaryRepo}.git`,
        branch: selectedRun.newBranch,
      },
      (response: CreateLocalWorkspaceResponse) => {
        if (response.success && response.workspacePath) {
          toast.success("Workspace created successfully!", {
            id: loadingToast,
            description: `Opening workspace at ${response.workspacePath}`,
          });

          // Navigate to the vscode view for this task run
          if (response.taskRunId) {
            navigate({
              to: "/$teamSlugOrId/task/$taskId/run/$runId/vscode",
              params: {
                teamSlugOrId,
                taskId,
                runId: response.taskRunId,
              },
            });
          }
        } else {
          toast.error(response.error || "Failed to create workspace", {
            id: loadingToast,
          });
        }
      }
    );
  }, [socket, teamSlugOrId, primaryRepo, selectedRun?.newBranch, navigate, taskId]);

  // Handler to trigger heatmap review
  const triggerHeatmapReview = useCallback((force = false) => {
    if (!primaryRepo || !selectedRun?.newBranch) {
      console.warn("[heatmap] Cannot trigger: missing primaryRepo or newBranch", {
        primaryRepo,
        newBranch: selectedRun?.newBranch,
      });
      return;
    }

    // Get the repo owner for comparison context
    const [repoOwner, repoName] = primaryRepo.split("/");
    if (!repoOwner || !repoName) {
      console.warn("[heatmap] Cannot trigger: invalid repo format", { primaryRepo });
      return;
    }

    // Use task.baseBranch or default to "main"
    const baseBranch = task?.baseBranch || "main";
    const githubLink = `https://github.com/${primaryRepo}`;
    const comparisonSlugValue = `${baseBranch}...${selectedRun.newBranch}`;

    console.log("[heatmap] Triggering heatmap review", {
      primaryRepo,
      baseBranch,
      headBranch: selectedRun.newBranch,
      comparisonSlug: comparisonSlugValue,
      force,
    });

    setHeatmapJobStarted(true);
    // Set comparisonSlug immediately to start subscription
    setComparisonSlug(comparisonSlugValue);

    codeReviewMutation.mutate({
      body: {
        teamSlugOrId,
        githubLink,
        headCommitRef: selectedRun.newBranch,
        baseCommitRef: baseBranch,
        force,
        comparison: {
          slug: comparisonSlugValue,
          base: {
            owner: repoOwner,
            repo: repoName,
            ref: baseBranch,
            label: `${repoOwner}:${baseBranch}`,
          },
          head: {
            owner: repoOwner,
            repo: repoName,
            ref: selectedRun.newBranch,
            label: `${repoOwner}:${selectedRun.newBranch}`,
          },
        },
      },
    });
  }, [primaryRepo, selectedRun?.newBranch, task?.baseBranch, teamSlugOrId, codeReviewMutation]);

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

  // Only show the "Open local workspace" button for regular tasks (not local/cloud workspaces)
  const isWorkspace = task?.isLocalWorkspace || task?.isCloudWorkspace;

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
            onExpandAllChecks={expandAllChecks}
            onCollapseAllChecks={collapseAllChecks}
            onOpenLocalWorkspace={isWorkspace ? undefined : handleOpenLocalWorkspace}
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
          {/* Heatmap review status and manual trigger */}
          <div className="mb-2 px-3.5 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="!h-7 text-xs"
              onClick={() => {
                setHeatmapJobStarted(false);
                setHeatmapByFile(undefined);
                setComparisonSlug(null);
                triggerHeatmapReview(false);
              }}
              disabled={codeReviewMutation.isPending || !primaryRepo || !selectedRun?.newBranch}
            >
              {codeReviewMutation.isPending ? "Running..." : heatmapByFile ? "Re-run Heatmap" : "Run Heatmap"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="!h-7 text-xs text-neutral-500"
              onClick={() => {
                setHeatmapJobStarted(false);
                setHeatmapByFile(undefined);
                setComparisonSlug(null);
                triggerHeatmapReview(true);
              }}
              disabled={codeReviewMutation.isPending || !primaryRepo || !selectedRun?.newBranch}
            >
              Force Restart
            </Button>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {heatmapByFile
                ? `${heatmapByFile.size} files analyzed`
                : comparisonSlug
                  ? `Streaming: ${fileOutputs?.length ?? 0} files`
                  : heatmapJobStarted
                    ? "Starting..."
                    : "Not started"}
            </span>
          </div>
          <div className="bg-white dark:bg-neutral-900 flex-1 min-h-0 flex flex-col">
            {pullRequests && pullRequests.length > 0 && (
              <Suspense fallback={null}>
                {pullRequests.map((pr) => (
                  <WorkflowRunsWrapper
                    key={pr.repoFullName}
                    teamSlugOrId={teamSlugOrId}
                    repoFullName={pr.repoFullName}
                    prNumber={pr.number}
                    headSha={undefined}
                    checksExpandedByRepo={checksExpandedByRepo}
                    setChecksExpandedByRepo={setChecksExpandedByRepo}
                  />
                ))}
              </Suspense>
            )}
            {screenshotSetsLoading ? (
              <div className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-950/40 px-3.5 py-3 text-sm text-neutral-500 dark:text-neutral-400">
                Loading screenshots...
              </div>
            ) : (
              <RunScreenshotGallery
                screenshotSets={screenshotSets}
                highlightedSetId={selectedRun?.latestScreenshotSetId ?? null}
              />
            )}
            <div className="flex-1 min-h-0">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
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
                    heatmapByFile={heatmapByFile}
                    heatmapThreshold={heatmapThreshold}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-sm text-neutral-600 dark:text-neutral-300">
                    Missing repo or branches to show diff.
                  </div>
                )}
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </FloatingPane>
  );
}
