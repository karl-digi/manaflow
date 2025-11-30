import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { useLocalStorage } from "@mantine/hooks";
import { useQuery } from "convex/react";
import clsx from "clsx";
import { memo, useCallback, useMemo, useState } from "react";
import { TaskItem } from "./TaskItem";
import { ChevronRight, ExternalLink } from "lucide-react";

type TaskCategoryKey =
  | "pinned"
  | "workspaces"
  | "ready_to_review"
  | "in_progress"
  | "merged";

const CATEGORY_ORDER: TaskCategoryKey[] = [
  "pinned",
  "workspaces",
  "ready_to_review",
  "in_progress",
  "merged",
];

const CATEGORY_META: Record<
  TaskCategoryKey,
  { title: string; emptyLabel: string }
> = {
  pinned: {
    title: "Pinned",
    emptyLabel: "No pinned items.",
  },
  workspaces: {
    title: "Workspaces",
    emptyLabel: "No workspace sessions yet.",
  },
  ready_to_review: {
    title: "Ready to review",
    emptyLabel: "Nothing is waiting for review.",
  },
  in_progress: {
    title: "In progress",
    emptyLabel: "No tasks are currently in progress.",
  },
  merged: {
    title: "Merged",
    emptyLabel: "No merged tasks yet.",
  },
};

type PreviewCategoryKey = "in_progress" | "completed";

const PREVIEW_CATEGORY_ORDER: PreviewCategoryKey[] = ["in_progress", "completed"];

const PREVIEW_CATEGORY_META: Record<
  PreviewCategoryKey,
  { title: string; emptyLabel: string }
> = {
  in_progress: {
    title: "In progress",
    emptyLabel: "No previews are currently running.",
  },
  completed: {
    title: "Completed",
    emptyLabel: "No completed previews yet.",
  },
};

const PREVIEW_STATUS_IN_PROGRESS = new Set<Doc<"previewRuns">["status"]>([
  "pending",
  "running",
]);

const PREVIEW_STATUS_COMPLETED = new Set<Doc<"previewRuns">["status"]>([
  "completed",
  "failed",
  "skipped",
]);

const isPreviewTask = (task: Doc<"tasks">): boolean =>
  task.isPreview === true ||
  task.text.startsWith("Preview screenshots for PR #");

const createEmptyCategoryBuckets = (): Record<
  TaskCategoryKey,
  Doc<"tasks">[]
> => ({
  pinned: [],
  workspaces: [],
  ready_to_review: [],
  in_progress: [],
  merged: [],
});

const getTaskCategory = (task: Doc<"tasks">): TaskCategoryKey => {
  if (task.isCloudWorkspace || task.isLocalWorkspace) {
    return "workspaces";
  }
  if (task.mergeStatus === "pr_merged") {
    return "merged";
  }
  if (task.crownEvaluationStatus === "succeeded") {
    return "ready_to_review";
  }
  return "in_progress";
};

const sortByRecentUpdate = (tasks: Doc<"tasks">[]): Doc<"tasks">[] => {
  if (tasks.length <= 1) {
    return tasks;
  }
  return [...tasks].sort(
    (a, b) =>
      (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0)
  );
};

const sortPreviewRunsByRecentUpdate = (
  runs: Doc<"previewRuns">[]
): Doc<"previewRuns">[] => {
  if (runs.length <= 1) {
    return runs;
  }
  return [...runs].sort(
    (a, b) =>
      (b.updatedAt ?? b.createdAt ?? 0) -
      (a.updatedAt ?? a.createdAt ?? 0)
  );
};

const categorizeTasks = (
  tasks: Doc<"tasks">[] | undefined
): Record<TaskCategoryKey, Doc<"tasks">[]> | null => {
  if (!tasks) {
    return null;
  }
  const buckets = createEmptyCategoryBuckets();
  for (const task of tasks) {
    const key = getTaskCategory(task);
    buckets[key].push(task);
  }
  for (const key of CATEGORY_ORDER) {
    buckets[key] = sortByRecentUpdate(buckets[key]);
  }
  return buckets;
};

const categorizePreviewRuns = (
  runs: Doc<"previewRuns">[] | undefined
): Record<PreviewCategoryKey, Doc<"previewRuns">[]> | null => {
  if (!runs) {
    return null;
  }
  const buckets: Record<PreviewCategoryKey, Doc<"previewRuns">[]> = {
    in_progress: [],
    completed: [],
  };
  for (const run of runs) {
    if (PREVIEW_STATUS_IN_PROGRESS.has(run.status)) {
      buckets.in_progress.push(run);
    } else if (PREVIEW_STATUS_COMPLETED.has(run.status)) {
      buckets.completed.push(run);
    } else {
      buckets.completed.push(run);
    }
  }
  for (const key of PREVIEW_CATEGORY_ORDER) {
    buckets[key] = sortPreviewRunsByRecentUpdate(buckets[key]);
  }
  return buckets;
};

const createCollapsedCategoryState = (
  defaultValue = false
): Record<TaskCategoryKey, boolean> => ({
  pinned: defaultValue,
  workspaces: defaultValue,
  ready_to_review: defaultValue,
  in_progress: defaultValue,
  merged: defaultValue,
});

const createPreviewCollapsedState = (
  defaultValue = false
): Record<PreviewCategoryKey, boolean> => ({
  in_progress: defaultValue,
  completed: defaultValue,
});

export const TaskList = memo(function TaskList({
  teamSlugOrId,
}: {
  teamSlugOrId: string;
}) {
  const allTasks = useQuery(api.tasks.get, { teamSlugOrId });
  const archivedTasks = useQuery(api.tasks.get, {
    teamSlugOrId,
    archived: true,
  });
  const pinnedData = useQuery(api.tasks.getPinned, { teamSlugOrId });
  const previewRuns = useQuery(api.previewRuns.listByTeam, { teamSlugOrId });
  const [tab, setTab] = useState<"all" | "archived" | "previews">("all");

  const splitTasks = useMemo(() => {
    if (!allTasks) {
      return null;
    }
    const preview: Doc<"tasks">[] = [];
    const regular: Doc<"tasks">[] = [];
    for (const task of allTasks) {
      if (isPreviewTask(task)) {
        preview.push(task);
      } else {
        regular.push(task);
      }
    }
    return { preview, regular };
  }, [allTasks]);

  const categorizedTasks = useMemo(() => {
    const categorized = categorizeTasks(splitTasks?.regular);
    if (categorized) {
      const safePinned = (pinnedData ?? []).filter(
        (task) => !isPreviewTask(task)
      );
      if (safePinned.length > 0) {
        const pinnedTaskIds = new Set(safePinned.map((t) => t._id));

        for (const key of CATEGORY_ORDER) {
          if (key !== "pinned") {
            categorized[key] = categorized[key].filter(
              (t) => !pinnedTaskIds.has(t._id)
            );
          }
        }

        // Add pinned tasks to the pinned category (already sorted by the API)
        categorized.pinned = safePinned;
      }
    }
    return categorized;
  }, [pinnedData, splitTasks]);

  const filteredArchivedTasks = useMemo(() => {
    if (!archivedTasks) {
      return archivedTasks;
    }
    return archivedTasks.filter((task) => !isPreviewTask(task));
  }, [archivedTasks]);

  const previewBuckets = useMemo(
    () => categorizePreviewRuns(previewRuns),
    [previewRuns]
  );
  const categoryBuckets = categorizedTasks ?? createEmptyCategoryBuckets();
  const collapsedStorageKey = useMemo(
    () => `dashboard-collapsed-categories-${teamSlugOrId}`,
    [teamSlugOrId]
  );
  const defaultCollapsedState = useMemo(
    () => createCollapsedCategoryState(),
    []
  );
  const [collapsedCategories, setCollapsedCategories] = useLocalStorage<
    Record<TaskCategoryKey, boolean>
  >({
    key: collapsedStorageKey,
    defaultValue: defaultCollapsedState,
    getInitialValueInEffect: true,
  });
  const previewCollapsedStorageKey = useMemo(
    () => `dashboard-preview-collapsed-categories-${teamSlugOrId}`,
    [teamSlugOrId]
  );
  const [collapsedPreviewCategories, setCollapsedPreviewCategories] =
    useLocalStorage<Record<PreviewCategoryKey, boolean>>({
      key: previewCollapsedStorageKey,
      defaultValue: createPreviewCollapsedState(),
      getInitialValueInEffect: true,
    });

  const toggleCategoryCollapse = useCallback((categoryKey: TaskCategoryKey) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [categoryKey]: !prev[categoryKey],
    }));
  }, [setCollapsedCategories]);
  const togglePreviewCategoryCollapse = useCallback(
    (categoryKey: PreviewCategoryKey) => {
      setCollapsedPreviewCategories((prev) => ({
        ...prev,
        [categoryKey]: !prev[categoryKey],
      }));
    },
    [setCollapsedPreviewCategories]
  );

  return (
    <div className="mt-6 w-full">
      <div className="mb-3 px-4">
        <div className="flex items-end gap-2.5 select-none">
          <button
            className={
              "text-sm font-medium transition-colors " +
              (tab === "all"
                ? "text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200")
            }
            onMouseDown={() => setTab("all")}
            onClick={() => setTab("all")}
          >
            Tasks
          </button>
          <button
            className={
              "text-sm font-medium transition-colors " +
              (tab === "archived"
                ? "text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200")
            }
            onMouseDown={() => setTab("archived")}
            onClick={() => setTab("archived")}
          >
            Archived
          </button>
          <button
            className={
              "text-sm font-medium transition-colors " +
              (tab === "previews"
                ? "text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200")
            }
            onMouseDown={() => setTab("previews")}
            onClick={() => setTab("previews")}
          >
            Previews
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1 w-full">
        {tab === "archived" ? (
          filteredArchivedTasks === undefined ? (
            <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 pl-4 select-none">
              Loading...
            </div>
          ) : filteredArchivedTasks.length === 0 ? (
            <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 pl-4 select-none">
              No archived tasks
            </div>
          ) : (
            filteredArchivedTasks.map((task) => (
              <TaskItem
                key={task._id}
                task={task}
                teamSlugOrId={teamSlugOrId}
              />
            ))
          )
        ) : tab === "previews" ? (
          previewRuns === undefined || previewBuckets === null ? (
            <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 pl-4 select-none">
              Loading...
            </div>
          ) : previewBuckets.in_progress.length === 0 &&
            previewBuckets.completed.length === 0 ? (
            <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 pl-4 select-none">
              No previews yet
            </div>
          ) : (
            <div className="mt-1 w-full flex flex-col space-y-[-1px] transform -translate-y-px">
              {PREVIEW_CATEGORY_ORDER.map((categoryKey) => (
                <PreviewRunSection
                  key={categoryKey}
                  categoryKey={categoryKey}
                  runs={previewBuckets[categoryKey]}
                  collapsed={Boolean(
                    collapsedPreviewCategories[categoryKey]
                  )}
                  onToggle={togglePreviewCategoryCollapse}
                />
              ))}
            </div>
          )
        ) : allTasks === undefined ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 pl-4 select-none">
            Loading...
          </div>
        ) : (
          <div className="mt-1 w-full flex flex-col space-y-[-1px] transform -translate-y-px">
            {CATEGORY_ORDER.map((categoryKey) => {
              // Don't render the pinned category if it's empty
              if (categoryKey === "pinned" && categoryBuckets[categoryKey].length === 0) {
                return null;
              }
              return (
                <TaskCategorySection
                  key={categoryKey}
                  categoryKey={categoryKey}
                  tasks={categoryBuckets[categoryKey]}
                  teamSlugOrId={teamSlugOrId}
                  collapsed={Boolean(collapsedCategories[categoryKey])}
                  onToggle={toggleCategoryCollapse}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

function TaskCategorySection({
  categoryKey,
  tasks,
  teamSlugOrId,
  collapsed,
  onToggle,
}: {
  categoryKey: TaskCategoryKey;
  tasks: Doc<"tasks">[];
  teamSlugOrId: string;
  collapsed: boolean;
  onToggle: (key: TaskCategoryKey) => void;
}) {
  const meta = CATEGORY_META[categoryKey];
  const handleToggle = useCallback(
    () => onToggle(categoryKey),
    [categoryKey, onToggle]
  );
  const contentId = `task-category-${categoryKey}`;
  const toggleLabel = collapsed
    ? `Expand ${meta.title}`
    : `Collapse ${meta.title}`;
  return (
    <div className="w-full">
      <div
        className="sticky top-0 z-10 flex w-full border-y border-neutral-200 dark:border-neutral-900 bg-neutral-100 dark:bg-neutral-800 select-none"
        onDoubleClick={handleToggle}
      >
        <div className="flex w-full items-center pr-4">
          <button
            type="button"
            onClick={handleToggle}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            aria-controls={contentId}
            className="flex h-9 w-9 items-center justify-center text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-300 dark:focus-visible:outline-neutral-700 transition-colors"
          >
            <ChevronRight
              className={clsx(
                "h-3 w-3 transition-transform duration-200",
                !collapsed && "rotate-90"
              )}
              aria-hidden="true"
            />
          </button>
          <div className="flex items-center gap-2 text-xs font-medium tracking-tight text-neutral-900 dark:text-neutral-100">
            <span>{meta.title}</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {tasks.length}
            </span>
          </div>
        </div>
      </div>
      {collapsed ? null : tasks.length > 0 ? (
        <div id={contentId} className="flex flex-col w-full">
          {tasks.map((task) => (
            <TaskItem key={task._id} task={task} teamSlugOrId={teamSlugOrId} />
          ))}
        </div>
      ) : (
        <div className="flex w-full items-center px-4 py-3">
          <p className="pl-5 text-xs text-neutral-500 dark:text-neutral-400 select-none">
            {meta.emptyLabel}
          </p>
        </div>
      )}
    </div>
  );
}

function PreviewRunSection({
  categoryKey,
  runs,
  collapsed,
  onToggle,
}: {
  categoryKey: PreviewCategoryKey;
  runs: Doc<"previewRuns">[];
  collapsed: boolean;
  onToggle: (key: PreviewCategoryKey) => void;
}) {
  const meta = PREVIEW_CATEGORY_META[categoryKey];
  const handleToggle = useCallback(
    () => onToggle(categoryKey),
    [categoryKey, onToggle]
  );
  const contentId = `preview-category-${categoryKey}`;
  const toggleLabel = collapsed
    ? `Expand ${meta.title}`
    : `Collapse ${meta.title}`;

  return (
    <div className="w-full">
      <div
        className="sticky top-0 z-10 flex w-full border-y border-neutral-200 dark:border-neutral-900 bg-neutral-100 dark:bg-neutral-800 select-none"
        onDoubleClick={handleToggle}
      >
        <div className="flex w-full items-center pr-4">
          <button
            type="button"
            onClick={handleToggle}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            aria-controls={contentId}
            className="flex h-9 w-9 items-center justify-center text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-300 dark:focus-visible:outline-neutral-700 transition-colors"
          >
            <ChevronRight
              className={clsx(
                "h-3 w-3 transition-transform duration-200",
                !collapsed && "rotate-90"
              )}
              aria-hidden="true"
            />
          </button>
          <div className="flex items-center gap-2 text-xs font-medium tracking-tight text-neutral-900 dark:text-neutral-100">
            <span>{meta.title}</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {runs.length}
            </span>
          </div>
        </div>
      </div>
      {collapsed ? null : runs.length > 0 ? (
        <div id={contentId} className="flex flex-col w-full">
          {runs.map((run) => (
            <PreviewRunItem key={run._id} run={run} />
          ))}
        </div>
      ) : (
        <div className="flex w-full items-center px-4 py-3">
          <p className="pl-5 text-xs text-neutral-500 dark:text-neutral-400 select-none">
            {meta.emptyLabel}
          </p>
        </div>
      )}
    </div>
  );
}

function PreviewRunItem({ run }: { run: Doc<"previewRuns"> }) {
  const statusMeta = getPreviewStatusMeta(run.status);
  const timestamp = run.updatedAt ?? run.completedAt ?? run.createdAt;
  const hasStateReason = Boolean(run.stateReason);

  return (
    <a
      href={run.prUrl}
      target="_blank"
      rel="noreferrer"
      className="relative grid w-full items-center py-2 pr-3 cursor-pointer select-none group grid-cols-[24px_1fr_minmax(120px,auto)_32px] bg-white dark:bg-neutral-900/50 hover:bg-neutral-50/90 dark:hover:bg-neutral-600/60"
      aria-label={`Open preview for PR #${run.prNumber}`}
    >
      <span
        className={clsx(
          "h-2.5 w-2.5 rounded-full border border-transparent justify-self-center",
          statusMeta.dotClass
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate text-neutral-900 dark:text-neutral-100">
            PR #{run.prNumber}
          </span>
          <span className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
            {run.repoFullName}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span className={clsx("font-medium", statusMeta.textClass)}>
            {statusMeta.label}
          </span>
          {run.headRef ? (
            <span className="truncate">
              · {run.headRef}
            </span>
          ) : null}
          {hasStateReason ? (
            <span className="truncate">
              · {run.stateReason}
            </span>
          ) : null}
        </div>
      </div>
      <div className="text-[11px] text-neutral-500 dark:text-neutral-400 flex-shrink-0 tabular-nums text-right">
        {formatPreviewTimestamp(timestamp)}
      </div>
      <ExternalLink
        className="w-4 h-4 text-neutral-400 dark:text-neutral-500 justify-self-end group-hover:text-neutral-700 dark:group-hover:text-neutral-300 transition-colors"
        aria-hidden="true"
      />
    </a>
  );
}

function getPreviewStatusMeta(
  status: Doc<"previewRuns">["status"]
): { label: string; dotClass: string; textClass: string } {
  switch (status) {
    case "pending":
      return {
        label: "Pending",
        dotClass: "bg-neutral-400",
        textClass: "text-neutral-600 dark:text-neutral-300",
      };
    case "running":
      return {
        label: "Running",
        dotClass: "bg-blue-500",
        textClass: "text-blue-600 dark:text-blue-400",
      };
    case "completed":
      return {
        label: "Completed",
        dotClass: "bg-green-500",
        textClass: "text-green-600 dark:text-green-400",
      };
    case "failed":
      return {
        label: "Failed",
        dotClass: "bg-red-500",
        textClass: "text-red-500 dark:text-red-400",
      };
    case "skipped":
      return {
        label: "Skipped",
        dotClass: "bg-amber-500",
        textClass: "text-amber-600 dark:text-amber-400",
      };
    default:
      return {
        label: "Unknown",
        dotClass: "bg-neutral-400",
        textClass: "text-neutral-600 dark:text-neutral-300",
      };
  }
}

function formatPreviewTimestamp(value?: number | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  if (isToday) {
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}
