import { useMemo, useState, Suspense } from "react";
import { useQueries, useQuery as useRQ } from "@tanstack/react-query";
import { MonacoGitDiffViewer } from "./monaco/monaco-git-diff-viewer";
import { gitDiffQueryOptions } from "@/queries/git-diff";
import { normalizeGitRef } from "@/lib/refWithOrigin";
import type { TaskRunWithChildren } from "@/types/task";
import type { Doc } from "@cmux/convex/dataModel";
import { RunScreenshotGallery } from "./RunScreenshotGallery";
import { useCombinedWorkflowData, WorkflowRunsSection } from "./WorkflowRunsSection";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@cmux/convex/api";

export interface TaskRunGitDiffPanelProps {
  task: Doc<"tasks"> | null | undefined;
  selectedRun: TaskRunWithChildren | null | undefined;
  teamSlugOrId: string;
}

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

export function TaskRunGitDiffPanel({ task, selectedRun, teamSlugOrId }: TaskRunGitDiffPanelProps) {
  const normalizedBaseBranch = useMemo(() => {
    const candidate = task?.baseBranch;
    if (candidate && candidate.trim()) {
      return normalizeGitRef(candidate);
    }
    return normalizeGitRef("main");
  }, [task?.baseBranch]);

  const normalizedHeadBranch = useMemo(
    () => normalizeGitRef(selectedRun?.newBranch),
    [selectedRun?.newBranch],
  );

  const environmentRepos = useMemo<string[]>(() => {
    const repos = selectedRun?.environment?.selectedRepos ?? [];
    const trimmed = repos
      .map((repo: string | undefined) => repo?.trim())
      .filter((repo): repo is string => Boolean(repo));
    return Array.from(new Set(trimmed));
  }, [selectedRun]);

  const repoFullNames = useMemo(() => {
    const names = new Set<string>();
    if (task?.projectFullName?.trim()) {
      names.add(task.projectFullName.trim());
    }
    for (const repo of environmentRepos) {
      names.add(repo);
    }
    return Array.from(names);
  }, [task?.projectFullName, environmentRepos]);

  const diffQueries = useQueries({
    queries: repoFullNames.map((repoFullName) => ({
      ...gitDiffQueryOptions({
        repoFullName,
        baseRef: normalizedBaseBranch || undefined,
        headRef: normalizedHeadBranch ?? "",
      }),
      enabled:
        Boolean(repoFullName?.trim()) && Boolean(normalizedHeadBranch?.trim()),
    })),
  });

  const allDiffs = useMemo(() => {
    return diffQueries.flatMap((query) => query.data ?? []);
  }, [diffQueries]);

  const isLoading = diffQueries.some((query) => query.isLoading);
  const hasError = diffQueries.some((query) => query.isError);

  // Get PR information from the selected run
  const pullRequests = useMemo(() => {
    return selectedRun?.pullRequests?.filter(
      (pr) => pr.number !== undefined && pr.number !== null
    ) as Array<{ repoFullName: string; number: number; url?: string }> | undefined;
  }, [selectedRun]);

  // Track expanded state for each PR's checks
  const [checksExpandedByRepo, setChecksExpandedByRepo] = useState<Record<string, boolean | null>>({});

  // Fetch screenshot data
  const runDiffContextQuery = useRQ({
    ...convexQuery(api.taskRuns.getRunDiffContext, {
      teamSlugOrId,
      taskId: task?._id ?? ("" as any),
      runId: selectedRun?._id ?? ("" as any),
    }),
    enabled: Boolean(teamSlugOrId && task?._id && selectedRun?._id),
  });

  const screenshotSets = runDiffContextQuery.data?.screenshotSets ?? [];
  const screenshotSetsLoading =
    runDiffContextQuery.isLoading && screenshotSets.length === 0;

  if (!selectedRun || !normalizedHeadBranch) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Select a run to view git diffs
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Loading diffs...
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Failed to load diffs
      </div>
    );
  }

  if (allDiffs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        No changes found
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto flex flex-col">
      {/* Checks Section */}
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

      {/* Screenshots Section */}
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

      {/* Git Diffs Section */}
      <div className="flex-1 min-h-0">
        <MonacoGitDiffViewer diffs={allDiffs} />
      </div>
    </div>
  );
}
