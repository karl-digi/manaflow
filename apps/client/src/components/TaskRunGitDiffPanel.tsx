import { useCallback, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { RunDiffSection } from "@/components/RunDiffSection";
import { RunScreenshotGallery } from "@/components/RunScreenshotGallery";
import { WorkflowRunsSection, useCombinedWorkflowData } from "@/components/WorkflowRunsSection";
import { normalizeGitRef } from "@/lib/refWithOrigin";
import type { TaskRunWithChildren } from "@/types/task";
import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { convexQuery } from "@convex-dev/react-query";

type ChecksExpandedState = Record<string, boolean | null>;

interface WorkflowRunsWrapperProps {
  teamSlugOrId: string;
  repoFullName: string;
  prNumber: number;
  headSha?: string;
  checksExpandedByRepo: ChecksExpandedState;
  setChecksExpandedByRepo: Dispatch<SetStateAction<ChecksExpandedState>>;
}

function WorkflowRunsWrapper({
  teamSlugOrId,
  repoFullName,
  prNumber,
  headSha,
  checksExpandedByRepo,
  setChecksExpandedByRepo,
}: WorkflowRunsWrapperProps) {
  const workflowData = useCombinedWorkflowData({
    teamSlugOrId,
    repoFullName,
    prNumber,
    headSha,
  });

  const hasAnyFailure = useMemo(() => {
    return workflowData.allRuns.some(
      (run) =>
        run.conclusion === "failure" ||
        run.conclusion === "timed_out" ||
        run.conclusion === "action_required",
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

export interface TaskRunGitDiffPanelProps {
  task: Doc<"tasks"> | null | undefined;
  selectedRun: TaskRunWithChildren | null | undefined;
  taskId?: Id<"tasks">;
  teamSlugOrId?: string;
}

export function TaskRunGitDiffPanel({
  task,
  selectedRun,
  taskId,
  teamSlugOrId,
}: TaskRunGitDiffPanelProps) {
  const [checksExpandedByRepo, setChecksExpandedByRepo] = useState<ChecksExpandedState>({});
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

  const [primaryRepo, ...additionalRepos] = repoFullNames;

  const branchMetadataQuery = useQuery(
    teamSlugOrId && primaryRepo
      ? convexQuery(api.github.getBranchesByRepo, {
        teamSlugOrId,
        repo: primaryRepo,
      })
      : {
        queryKey: ["github:getBranchesByRepo", teamSlugOrId, primaryRepo],
        queryFn: async () => undefined,
        enabled: false,
      },
  );

  const branchMetadata = branchMetadataQuery.data as Doc<"branches">[] | undefined;

  const baseBranchMetadata = useMemo(() => {
    if (!task?.baseBranch) {
      return undefined;
    }
    return branchMetadata?.find((branch) => branch.name === task.baseBranch);
  }, [branchMetadata, task?.baseBranch]);

  const metadataByRepo = useMemo(() => {
    if (!primaryRepo || !baseBranchMetadata) {
      return undefined;
    }
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

  const effectiveTaskId = taskId ?? selectedRun?.taskId;
  const runId = selectedRun?._id;
  const shouldFetchDiffContext =
    Boolean(teamSlugOrId) && Boolean(effectiveTaskId) && Boolean(runId);

  const runDiffContextQuery = useQuery(
    shouldFetchDiffContext && teamSlugOrId && effectiveTaskId && runId
      ? convexQuery(api.taskRuns.getRunDiffContext, {
        teamSlugOrId,
        taskId: effectiveTaskId,
        runId,
      })
      : {
        queryKey: ["taskRuns:getRunDiffContext", teamSlugOrId, effectiveTaskId, runId],
        queryFn: async () => undefined,
        enabled: false,
      },
  );

  const screenshotSets = runDiffContextQuery.data?.screenshotSets ?? [];
  const screenshotSetsLoading =
    runDiffContextQuery.isLoading && screenshotSets.length === 0;

  const pullRequests = useMemo(() => {
    return selectedRun?.pullRequests?.filter(
      (pr) => pr.number !== undefined && pr.number !== null,
    ) as Array<{ repoFullName: string; number: number; url?: string }> | undefined;
  }, [selectedRun]);

  const hasDiffSources =
    Boolean(primaryRepo) && Boolean(normalizedBaseBranch) && Boolean(normalizedHeadBranch);
  const shouldPrefixDiffs = repoFullNames.length > 1;

  const renderEmptyState = useCallback((message: string) => {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        {message}
      </div>
    );
  }, []);

  if (!selectedRun) {
    return renderEmptyState("Select a run to view git diffs");
  }

  if (!normalizedHeadBranch) {
    return renderEmptyState("Selected run has no branch yet");
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-900">
      {teamSlugOrId && pullRequests && pullRequests.length > 0 ? (
        <div className="border-b border-neutral-200 dark:border-neutral-800">
          {pullRequests.map((pr) => (
            <WorkflowRunsWrapper
              key={`${pr.repoFullName}:${pr.number}`}
              teamSlugOrId={teamSlugOrId}
              repoFullName={pr.repoFullName}
              prNumber={pr.number}
              headSha={undefined}
              checksExpandedByRepo={checksExpandedByRepo}
              setChecksExpandedByRepo={setChecksExpandedByRepo}
            />
          ))}
        </div>
      ) : null}
      {shouldFetchDiffContext ? (
        screenshotSetsLoading ? (
          <div className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-950/40 px-3.5 py-3 text-sm text-neutral-500 dark:text-neutral-400">
            Loading screenshots...
          </div>
        ) : (
          <RunScreenshotGallery
            screenshotSets={screenshotSets}
            highlightedSetId={selectedRun?.latestScreenshotSetId ?? null}
          />
        )
      ) : null}
      <div className="flex-1 min-h-0">
        {hasDiffSources ? (
          <RunDiffSection
            repoFullName={primaryRepo as string}
            additionalRepoFullNames={additionalRepos}
            withRepoPrefix={shouldPrefixDiffs}
            ref1={normalizedBaseBranch}
            ref2={normalizedHeadBranch}
            metadataByRepo={metadataByRepo}
          />
        ) : (
          renderEmptyState("Missing repository or branch information.")
        )}
      </div>
    </div>
  );
}
