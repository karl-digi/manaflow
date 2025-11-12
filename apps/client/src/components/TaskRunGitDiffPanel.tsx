import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { MonacoGitDiffViewer } from "./monaco/monaco-git-diff-viewer";
import { RunScreenshotGallery } from "./RunScreenshotGallery";
import { gitDiffQueryOptions } from "@/queries/git-diff";
import { normalizeGitRef } from "@/lib/refWithOrigin";
import { api } from "@cmux/convex/api";
import { convexQuery } from "@convex-dev/react-query";
import type { TaskRunWithChildren } from "@/types/task";
import type { Doc } from "@cmux/convex/dataModel";

export interface TaskRunGitDiffPanelProps {
  task: Doc<"tasks"> | null | undefined;
  selectedRun: TaskRunWithChildren | null | undefined;
}

export function TaskRunGitDiffPanel({ task, selectedRun }: TaskRunGitDiffPanelProps) {
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

  // Fetch screenshot data for the selected run
  const runDiffContextQuery = useQuery({
    ...convexQuery(api.taskRuns.getRunDiffContext,
      task?.teamId && task?._id && selectedRun?._id
        ? {
            teamSlugOrId: task.teamId,
            taskId: task._id,
            runId: selectedRun._id,
          }
        : "skip"
    ),
    enabled: Boolean(task?.teamId && task?._id && selectedRun?._id),
  });

  const screenshotSets = runDiffContextQuery.data?.screenshotSets ?? [];
  const screenshotSetsLoading =
    runDiffContextQuery.isLoading && screenshotSets.length === 0;

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

  if (!selectedRun || !normalizedHeadBranch) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Select a run to view git diffs
      </div>
    );
  }

  if (isLoading && allDiffs.length === 0 && !screenshotSets.length) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Loading...
      </div>
    );
  }

  if (hasError && !screenshotSets.length) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Failed to load content
      </div>
    );
  }

  const hasContent = allDiffs.length > 0 || screenshotSets.length > 0;

  if (!hasContent) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        No changes or screenshots found
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-auto flex flex-col">
      {/* Screenshots section */}
      {screenshotSetsLoading ? (
        <div className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-950/40 px-3.5 py-3 text-sm text-neutral-500 dark:text-neutral-400">
          Loading screenshots...
        </div>
      ) : screenshotSets.length > 0 ? (
        <RunScreenshotGallery
          screenshotSets={screenshotSets}
          highlightedSetId={selectedRun?.latestScreenshotSetId ?? null}
        />
      ) : null}

      {/* Git diff section */}
      {allDiffs.length > 0 ? (
        <div className="flex-1 min-h-0">
          <MonacoGitDiffViewer diffs={allDiffs} />
        </div>
      ) : isLoading ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
          Loading diffs...
        </div>
      ) : null}
    </div>
  );
}
