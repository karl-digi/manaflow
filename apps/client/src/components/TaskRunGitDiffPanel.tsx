import { useMemo } from "react";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import { RunDiffSection } from "./RunDiffSection";
import { RunScreenshotGallery } from "./RunScreenshotGallery";
import { WorkflowRunsForPullRequest } from "./WorkflowRunsSection";
import { normalizeGitRef } from "@/lib/refWithOrigin";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@cmux/convex/api";
import type { TaskRunWithChildren } from "@/types/task";
import type { Doc, Id } from "@cmux/convex/dataModel";

type RunPullRequest = {
  repoFullName: string;
  number: number;
  url?: string;
};

export interface TaskRunGitDiffPanelProps {
  task: Doc<"tasks"> | null | undefined;
  selectedRun: TaskRunWithChildren | null | undefined;
  teamSlugOrId: string;
  taskId: Id<"tasks">;
}

export function TaskRunGitDiffPanel({
  task,
  selectedRun,
  teamSlugOrId,
  taskId,
}: TaskRunGitDiffPanelProps) {
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
    environmentRepos.forEach((repo) => names.add(repo));
    return Array.from(names);
  }, [task?.projectFullName, environmentRepos]);

  const [primaryRepo, ...additionalRepos] = repoFullNames;

  const branchMetadataQuery = useReactQuery({
    ...convexQuery(api.github.getBranchesByRepo, {
      teamSlugOrId,
      repo: primaryRepo ?? "",
    }),
    enabled: Boolean(teamSlugOrId && primaryRepo),
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

  const runDiffQueryOptions = useMemo(() => {
    if (!selectedRun?._id) {
      return null;
    }
    return convexQuery(api.taskRuns.getRunDiffContext, {
      teamSlugOrId,
      taskId,
      runId: selectedRun._id,
    });
  }, [selectedRun?._id, taskId, teamSlugOrId]);

  const runDiffContextQuery = useReactQuery({
    ...(runDiffQueryOptions ?? {
      queryKey: ["taskRuns:getRunDiffContext", "disabled"],
      queryFn: async () => null,
    }),
    enabled: Boolean(runDiffQueryOptions),
  });

  const screenshotSets = runDiffContextQuery.data?.screenshotSets ?? [];
  const screenshotSetsLoading =
    runDiffContextQuery.isLoading && screenshotSets.length === 0;

  const pullRequests = useMemo(() => {
    return selectedRun?.pullRequests?.filter(
      (pr): pr is RunPullRequest =>
        pr.number !== undefined && pr.number !== null && Boolean(pr.repoFullName),
    );
  }, [selectedRun]);

  if (!selectedRun || !normalizedHeadBranch) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Select a run to view git diffs
      </div>
    );
  }

  const baseRef = normalizedBaseBranch;
  const headRef = normalizedHeadBranch;
  const hasDiffSources =
    Boolean(primaryRepo) && Boolean(baseRef) && Boolean(headRef);
  const shouldPrefixDiffs = repoFullNames.length > 1;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-neutral-900">
      {pullRequests && pullRequests.length > 0 ? (
        <div className="flex flex-col">
          {pullRequests.map((pr) => (
            <WorkflowRunsForPullRequest
              key={`${pr.repoFullName}:${pr.number}`}
              teamSlugOrId={teamSlugOrId}
              repoFullName={pr.repoFullName}
              prNumber={pr.number}
              headSha={undefined}
            />
          ))}
        </div>
      ) : null}
      {screenshotSetsLoading ? (
        <div className="border-b border-neutral-200 bg-neutral-50/60 px-3.5 py-3 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950/40 dark:text-neutral-400">
          Loading screenshots...
        </div>
      ) : (
        <RunScreenshotGallery
          screenshotSets={screenshotSets}
          highlightedSetId={selectedRun.latestScreenshotSetId ?? null}
        />
      )}
      <div className="flex-1 min-h-0">
        {hasDiffSources ? (
          <RunDiffSection
            repoFullName={primaryRepo as string}
            additionalRepoFullNames={additionalRepos}
            withRepoPrefix={shouldPrefixDiffs}
            ref1={baseRef as string}
            ref2={headRef as string}
            metadataByRepo={metadataByRepo}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
            Missing repo or branches to show diff.
          </div>
        )}
      </div>
    </div>
  );
}
