/**
 * Types and utilities for managing pull request state across task runs.
 */

/** The state of a pull request for a single task run */
export type RunPullRequestState =
  | "none"
  | "draft"
  | "open"
  | "merged"
  | "closed"
  | "unknown";

/** The overall merge status of a task (derived from all PRs) */
export type TaskMergeStatus =
  | "none"
  | "pr_draft"
  | "pr_open"
  | "pr_merged"
  | "pr_closed";

/** Stored information about a pull request */
export interface StoredPullRequestInfo {
  /** Full repository name (e.g., "owner/repo") */
  repoFullName: string;
  /** URL to the pull request */
  url?: string;
  /** Pull request number */
  number?: number;
  /** Current state of the pull request */
  state: RunPullRequestState;
  /** Whether the PR is a draft */
  isDraft?: boolean;
}

/** Result of a pull request action (create, sync, etc.) */
export interface PullRequestActionResult extends StoredPullRequestInfo {
  /** Error message if the action failed */
  error?: string;
}

/** Aggregated summary of pull request state across all repos */
export interface AggregatePullRequestSummary {
  /** Overall state based on all PRs */
  state: RunPullRequestState;
  /** Whether any PR is a draft */
  isDraft: boolean;
  /** URL of the first PR with a URL */
  url?: string;
  /** Number of the first PR with a number */
  number?: number;
  /** Task-level merge status */
  mergeStatus: TaskMergeStatus;
}

/**
 * Priority order for PR states when aggregating.
 * Lower index = higher priority.
 */
const STATE_PRIORITY: RunPullRequestState[] = [
  "open",
  "draft",
  "closed",
  "unknown",
  "none",
];

/**
 * Normalizes a repository name by trimming whitespace.
 */
function normalizeRepoName(repoFullName: string): string {
  return repoFullName.trim();
}

/**
 * Sorts pull request info records by repository name alphabetically.
 *
 * @param records - Array of records with repoFullName property
 * @returns Sorted copy of the array
 */
export function sortPullRequestInfos<T extends { repoFullName: string }>(
  records: readonly T[]
): T[] {
  return [...records].sort((a, b) =>
    normalizeRepoName(a.repoFullName).localeCompare(
      normalizeRepoName(b.repoFullName)
    )
  );
}

/**
 * Aggregates pull request state across multiple repositories into a summary.
 * Uses state priority to determine the overall state when PRs have different states.
 *
 * @param records - Array of pull request info records
 * @returns Aggregated summary of PR state
 */
export function aggregatePullRequestState(
  records: readonly StoredPullRequestInfo[]
): AggregatePullRequestSummary {
  if (records.length === 0) {
    return {
      state: "none",
      isDraft: false,
      mergeStatus: "none",
    };
  }

  const states = records.map((record) => record.state);

  const allMerged = states.length > 0 && states.every((state) => state === "merged");
  const anyOpen = states.some((state) => state === "open");
  const anyDraft = states.some((state) => state === "draft");
  const anyClosed = states.some((state) => state === "closed");
  const anyUnknown = states.some((state) => state === "unknown");
  const anyMerged = states.some((state) => state === "merged");

  let state: RunPullRequestState = "none";
  if (allMerged) {
    state = "merged";
  } else if (anyOpen) {
    state = "open";
  } else if (anyDraft) {
    state = "draft";
  } else if (anyClosed) {
    state = "closed";
  } else if (anyUnknown) {
    state = "unknown";
  } else if (anyMerged) {
    state = "merged";
  }

  const mergeStatus: TaskMergeStatus = (() => {
    switch (state) {
      case "draft":
        return "pr_draft";
      case "open":
        return "pr_open";
      case "merged":
        return "pr_merged";
      case "closed":
        return "pr_closed";
      default:
        return "none";
    }
  })();

  const sorted = sortPullRequestInfos(records);
  const firstWithUrl = sorted.find((record) => Boolean(record.url));
  const firstWithNumber = sorted.find((record) => record.number !== undefined);

  return {
    state,
    isDraft: state === "draft",
    url: firstWithUrl?.url,
    number: firstWithNumber?.number,
    mergeStatus,
  };
}

/**
 * Reconciles existing PR records with new updates, producing a merged result.
 * Handles merging state from multiple sources and extracting errors.
 *
 * @param options.existing - Current stored PR records
 * @param options.updates - New PR action results to merge in
 * @param options.repoFullNames - Optional list of all repo names to include
 * @returns Merged records, aggregate summary, and any errors
 */
export function reconcilePullRequestRecords({
  existing,
  updates,
  repoFullNames,
}: {
  existing: readonly StoredPullRequestInfo[];
  updates: readonly PullRequestActionResult[];
  repoFullNames?: readonly string[];
}): {
  records: StoredPullRequestInfo[];
  aggregate: AggregatePullRequestSummary;
  errors: PullRequestActionResult[];
} {
  const existingMap = new Map(
    existing.map((record) => [normalizeRepoName(record.repoFullName), record] as const)
  );
  const updateMap = new Map(
    updates.map((record) => [normalizeRepoName(record.repoFullName), record] as const)
  );

  const repoNames = new Set<string>();
  for (const name of repoFullNames ?? []) {
    repoNames.add(normalizeRepoName(name));
  }
  for (const name of existingMap.keys()) {
    repoNames.add(name);
  }
  for (const name of updateMap.keys()) {
    repoNames.add(name);
  }

  const records: StoredPullRequestInfo[] = [];

  for (const repoName of sortPullRequestInfos(
    Array.from(repoNames).map((repoFullName) => ({ repoFullName }))
  ).map((item) => normalizeRepoName(item.repoFullName))) {
    const update = updateMap.get(repoName);
    const existingRecord = existingMap.get(repoName);

    if (update && !update.error) {
      records.push({
        repoFullName: repoName,
        url: update.url ?? existingRecord?.url,
        number: update.number ?? existingRecord?.number,
        state: update.state ?? existingRecord?.state ?? "none",
        isDraft:
          update.isDraft ??
          (update.state ? update.state === "draft" : existingRecord?.isDraft),
      });
      continue;
    }

    if (existingRecord) {
      records.push(existingRecord);
      continue;
    }

    const fallbackState = update?.state ?? "none";
    records.push({
      repoFullName: repoName,
      state: fallbackState,
      url: update?.url,
      number: update?.number,
      isDraft: update?.isDraft ?? (fallbackState === "draft" ? true : undefined),
    });
  }

  const aggregate = aggregatePullRequestState(records);
  const errors = updates.filter((record) => Boolean(record.error));

  return {
    records,
    aggregate,
    errors,
  };
}

/**
 * Determines if an incoming PR state should replace the current state.
 * Based on state priority (open > draft > closed > unknown > none).
 *
 * @param incoming - The new state to evaluate
 * @param current - The existing state
 * @returns True if incoming state has higher priority than current
 */
export function isBetterState(
  incoming: RunPullRequestState,
  current: RunPullRequestState
): boolean {
  if (incoming === current) {
    return false;
  }
  const incomingPriority = STATE_PRIORITY.indexOf(incoming);
  const currentPriority = STATE_PRIORITY.indexOf(current);
  if (incomingPriority === -1 || currentPriority === -1) {
    return true;
  }
  return incomingPriority < currentPriority;
}
