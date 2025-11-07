import {
  Suspense,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { RunDiffSection } from "./RunDiffSection";
import { RunScreenshotGallery } from "./RunScreenshotGallery";
import { normalizeGitRef } from "@/lib/refWithOrigin";
import type { TaskRunWithChildren } from "@/types/task";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { api } from "@cmux/convex/api";
import { useQuery as useConvexQuery } from "convex/react";
import {
  WorkflowRunsSection,
  useCombinedWorkflowData,
} from "./WorkflowRunsSection";

export interface TaskRunGitDiffPanelProps {
  task: Doc<"tasks"> | null | undefined;
  selectedRun: TaskRunWithChildren | null | undefined;
  teamSlugOrId: string;
  taskId: Id<"tasks">;
}

interface WorkflowRunsWrapperProps {
  teamSlugOrId: string;
  repoFullName: string;
  prNumber: number;
  headSha?: string;
  checksExpandedByRepo: Record<string, boolean | null>;
  setChecksExpandedByRepo: Dispatch<
    SetStateAction<Record<string, boolean | null>>
  >;
}

function WorkflowRunsWrapper(props: WorkflowRunsWrapperProps) {
  const {
    teamSlugOrId,
    repoFullName,
    prNumber,
    headSha,
    checksExpandedByRepo,
    setChecksExpandedByRepo,
  } = props;

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

type RunPullRequest = NonNullable<
  TaskRunWithChildren["pullRequests"]
>[number];

type RunPullRequestWithNumber = RunPullRequest & { number: number };

function isValidPullRequest(
  pr: RunPullRequest | undefined,
): pr is RunPullRequestWithNumber {
  if (!pr) {
    return false;
  }
  if (!pr.repoFullName?.trim()) {
    return false;
  }
  if (pr.number === undefined || pr.number === null) {
    return false;
  }
  return true;
}

export function TaskRunGitDiffPanel({
  task,
  selectedRun,
  teamSlugOrId,
  taskId,
}: TaskRunGitDiffPanelProps) {
  const [checksExpandedByRepo, setChecksExpandedByRepo] = useState<
    Record<string, boolean | null>
  >({});

  const runDiffContext = useConvexQuery(
    api.taskRuns.getRunDiffContext,
    selectedRun?._id
      ? {
          teamSlugOrId,
          taskId,
          runId: selectedRun._id,
        }
      : "skip",
  );

  const screenshotSets =
    selectedRun?._id && runDiffContext
      ? runDiffContext.screenshotSets ?? []
      : [];
  const screenshotSetsLoading =
    Boolean(selectedRun?._id) && runDiffContext === undefined;

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
  const shouldPrefixDiffs = repoFullNames.length > 1;

  const branchMetadataByRepo = runDiffContext?.branchMetadataByRepo;
  const metadataByRepo = useMemo(() => {
    if (!primaryRepo) return undefined;
    if (!task?.baseBranch) return undefined;
    const metadata = branchMetadataByRepo?.[primaryRepo];
    if (!metadata?.length) return undefined;
    const baseBranchMetadata = metadata.find(
      (branch) => branch.name === task.baseBranch,
    );
    if (!baseBranchMetadata) {
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
  }, [branchMetadataByRepo, primaryRepo, task?.baseBranch]);

  const pullRequests = useMemo(() => {
    return selectedRun?.pullRequests?.filter(isValidPullRequest) ?? [];
  }, [selectedRun?.pullRequests]);

  if (!selectedRun || !normalizedHeadBranch) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Select a run to view git diffs
      </div>
    );
  }

  const hasDiffSources =
    Boolean(primaryRepo) && Boolean(normalizedBaseBranch) && Boolean(normalizedHeadBranch);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-950">
      {pullRequests.length > 0 ? (
        <Suspense fallback={null}>
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
        </Suspense>
      ) : null}
      {screenshotSetsLoading ? (
        <div className="border-b border-neutral-200 bg-neutral-50/60 px-3.5 py-3 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950/40 dark:text-neutral-400">
          Loading screenshots...
        </div>
      ) : (
        <RunScreenshotGallery
          screenshotSets={screenshotSets}
          highlightedSetId={selectedRun?.latestScreenshotSetId ?? null}
        />
      )}
      <div className="flex-1 min-h-0">
        {hasDiffSources ? (
          <RunDiffSection
            key={`${primaryRepo}:${normalizedBaseBranch}:${normalizedHeadBranch}`}
            repoFullName={primaryRepo as string}
            additionalRepoFullNames={additionalRepos}
            withRepoPrefix={shouldPrefixDiffs}
            ref1={normalizedBaseBranch as string}
            ref2={normalizedHeadBranch}
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
