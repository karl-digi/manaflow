import { useMemo, useState } from "react";
import { WorkflowRuns, WorkflowRunsSection } from "./prs/pull-request-checks";
import { useCombinedWorkflowData } from "./prs/useCombinedWorkflowData";

export interface TaskRunPullRequestTarget {
  repoFullName: string;
  prNumber: number;
  url?: string;
  headSha?: string;
}

interface TaskRunChecksProps {
  teamSlugOrId: string;
  targets: TaskRunPullRequestTarget[];
  className?: string;
}

function PullRequestChecksRow({
  teamSlugOrId,
  target,
}: {
  teamSlugOrId: string;
  target: TaskRunPullRequestTarget;
}) {
  const { repoFullName, prNumber, url, headSha } = target;
  const { allRuns, isLoading } = useCombinedWorkflowData({
    teamSlugOrId,
    repoFullName,
    prNumber,
    headSha,
  });

  const hasAnyFailure = useMemo(
    () =>
      allRuns.some(
        (run) =>
          run.conclusion === "failure" ||
          run.conclusion === "timed_out" ||
          run.conclusion === "action_required",
      ),
    [allRuns],
  );

  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const isExpanded =
    expandedOverride !== null ? expandedOverride : hasAnyFailure;

  const handleToggle = () => {
    setExpandedOverride((prev) => (prev !== null ? !prev : !isExpanded));
  };

  const fallbackUrl = `https://github.com/${repoFullName}/pull/${prNumber}`;

  return (
    <div className="border-t border-neutral-200 dark:border-neutral-800 first:border-t-0">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
            {repoFullName}
          </span>
          <a
            href={url ?? fallbackUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-mono text-blue-600 dark:text-blue-400 hover:underline shrink-0"
          >
            #{prNumber}
          </a>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          {isLoading ? (
            <span className="text-[11px]">Loading…</span>
          ) : allRuns.length === 0 ? (
            <span className="text-[11px]">No checks yet</span>
          ) : (
            <WorkflowRuns allRuns={allRuns} isLoading={false} />
          )}
        </div>
      </div>
      {isLoading || allRuns.length > 0 ? (
        <WorkflowRunsSection
          allRuns={allRuns}
          isLoading={isLoading}
          isExpanded={isExpanded}
          onToggle={handleToggle}
        />
      ) : (
        <div className="px-3 pb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          Checks will appear here once they start running.
        </div>
      )}
    </div>
  );
}

export function TaskRunChecks({
  teamSlugOrId,
  targets,
  className,
}: TaskRunChecksProps) {
  const dedupedTargets = useMemo(() => {
    const map = new Map<string, TaskRunPullRequestTarget>();
    for (const target of targets) {
      if (!target.repoFullName || !Number.isFinite(target.prNumber)) {
        continue;
      }
      const key = `${target.repoFullName}#${target.prNumber}`;
      if (!map.has(key)) {
        map.set(key, target);
      }
    }
    return Array.from(map.values());
  }, [targets]);

  if (dedupedTargets.length === 0) {
    return null;
  }

  const containerClassName = className
    ? `rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 ${className}`
    : "rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40";

  return (
    <div className={containerClassName}>
      <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
        <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          CI/CD & Checks
        </p>
      </div>
      <div>
        {dedupedTargets.map((target) => (
          <PullRequestChecksRow
            key={`${target.repoFullName}#${target.prNumber}`}
            teamSlugOrId={teamSlugOrId}
            target={target}
          />
        ))}
      </div>
    </div>
  );
}
