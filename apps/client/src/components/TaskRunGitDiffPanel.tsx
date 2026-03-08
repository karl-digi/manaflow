import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useQuery } from "convex/react";
import { NewGitDiffViewer } from "./git-diff-view/git-diff-viewer";
import { RunScreenshotGallery } from "./RunScreenshotGallery";
import { gitDiffQueryOptions } from "@/queries/git-diff";
import { normalizeGitRef } from "@/lib/refWithOrigin";
import type { TaskRunWithChildren } from "@/types/task";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { api } from "@cmux/convex/api";

export interface TaskRunGitDiffPanelProps {
  task: Doc<"tasks"> | null | undefined;
  taskRuns?: TaskRunWithChildren[] | null | undefined;
  selectedRun: TaskRunWithChildren | null | undefined;
  teamSlugOrId: string;
  taskId: Id<"tasks">;
  selectedRunId: Id<"taskRuns"> | null | undefined;
}

export function TaskRunGitDiffPanel({ task, taskRuns, selectedRun, teamSlugOrId, taskId, selectedRunId }: TaskRunGitDiffPanelProps) {
  // Check for cloud/local workspace (no GitHub repo to diff against)
  const isCloudOrLocalWorkspace = task?.isCloudWorkspace || task?.isLocalWorkspace;

  // Find parent run if this is a child run (for comparing against parent's branch)
  const parentRun = useMemo(() => {
    if (!selectedRun?.parentRunId || !taskRuns) return null;
    return taskRuns.find((run) => run._id === selectedRun.parentRunId) ?? null;
  }, [selectedRun?.parentRunId, taskRuns]);

  // Determine base ref for diff comparison with priority:
  // 1. Parent run's branch (for child runs)
  // 2. Starting commit SHA (for new tasks in custom environments)
  // 3. Task's base branch (explicit user choice)
  const normalizedBaseBranch = useMemo(() => {
    // Priority 1: Parent run's branch (for child runs)
    if (parentRun?.newBranch) {
      return normalizeGitRef(parentRun.newBranch);
    }
    // Priority 2: Starting commit SHA (for new tasks in custom environments)
    if (selectedRun?.startingCommitSha) {
      return selectedRun.startingCommitSha; // Direct SHA, no normalization needed
    }
    // Priority 3: Task's base branch
    const candidate = task?.baseBranch;
    if (candidate && candidate.trim()) {
      return normalizeGitRef(candidate);
    }
    return undefined;
  }, [parentRun?.newBranch, selectedRun?.startingCommitSha, task?.baseBranch]);

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
    const projectName = task?.projectFullName?.trim();
    // Skip environment-based project names (format: env:<environmentId>)
    if (projectName && !projectName.startsWith("env:")) {
      names.add(projectName);
    }
    for (const repo of environmentRepos) {
      const trimmed = repo?.trim();
      // Skip environment references in selectedRepos as well
      if (trimmed && !trimmed.startsWith("env:")) {
        names.add(trimmed);
      }
    }
    // Add discovered repos from sandbox (for custom environments)
    for (const repo of selectedRun?.discoveredRepos ?? []) {
      const trimmed = repo?.trim();
      if (trimmed && !trimmed.startsWith("env:")) {
        names.add(trimmed);
      }
    }
    return Array.from(names);
  }, [task?.projectFullName, environmentRepos, selectedRun?.discoveredRepos]);

  const diffQueries = useQueries({
    queries: repoFullNames.map((repoFullName) => ({
      ...gitDiffQueryOptions({
        repoFullName,
        baseRef: normalizedBaseBranch || undefined,
        headRef: normalizedHeadBranch ?? "",
      }),
      // Skip queries for cloud/local workspaces since they don't have GitHub repos
      enabled:
        !isCloudOrLocalWorkspace &&
        Boolean(repoFullName?.trim()) &&
        Boolean(normalizedHeadBranch?.trim()),
    })),
  });

  const allDiffs = useMemo(() => {
    return diffQueries.flatMap((query) => query.data ?? []);
  }, [diffQueries]);

  const isLoading = diffQueries.some((query) => query.isLoading);
  const hasError = diffQueries.some((query) => query.isError);

  // Fetch screenshot sets for the selected run (skip for cloud/local workspaces)
  const runDiffContext = useQuery(
    api.taskRuns.getRunDiffContext,
    !isCloudOrLocalWorkspace && selectedRunId && teamSlugOrId && taskId
      ? { teamSlugOrId, taskId, runId: selectedRunId }
      : "skip"
  );

  const screenshotSets = runDiffContext?.screenshotSets ?? [];
  const screenshotConfig = runDiffContext?.screenshotConfig;
  const screenshotSetsLoading = runDiffContext === undefined && screenshotSets.length === 0;

  // Skip git diff for cloud/local workspaces (no GitHub repo to diff against)
  if (isCloudOrLocalWorkspace) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Git diff not available for cloud workspaces
      </div>
    );
  }

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
    <div className="relative h-full min-h-0 overflow-auto">
      {screenshotSetsLoading ? (
        <div className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-950/40 px-3.5 py-3 text-sm text-neutral-500 dark:text-neutral-400">
          Loading screenshots...
        </div>
      ) : (
        <RunScreenshotGallery
          screenshotSets={screenshotSets}
          screenshotConfig={screenshotConfig}
        />
      )}
      <NewGitDiffViewer diffs={allDiffs} />
    </div>
  );
}
