import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { useQuery } from "convex/react";
import { memo, useMemo, useState } from "react";
import { TaskItem } from "./TaskItem";

type TaskCategoryKey =
  | "workspaces"
  | "ready_to_review"
  | "in_progress"
  | "merged";

const CATEGORY_ORDER: TaskCategoryKey[] = [
  "workspaces",
  "ready_to_review",
  "in_progress",
  "merged",
];

const CATEGORY_META: Record<
  TaskCategoryKey,
  { title: string; emptyLabel: string }
> = {
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

const READY_TO_REVIEW_STATUSES: ReadonlySet<Doc<"tasks">["mergeStatus"]> =
  new Set(["pr_open", "pr_approved", "pr_changes_requested"]);

const createEmptyCategoryBuckets = (): Record<
  TaskCategoryKey,
  Doc<"tasks">[]
> => ({
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
  if (task.mergeStatus && READY_TO_REVIEW_STATUSES.has(task.mergeStatus)) {
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
      (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
  );
};

const categorizeTasks = (
  tasks: Doc<"tasks">[] | undefined,
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
  const [tab, setTab] = useState<"all" | "archived">("all");

  const categorizedTasks = useMemo(
    () => categorizeTasks(allTasks),
    [allTasks],
  );
  const categoryBuckets =
    categorizedTasks ?? createEmptyCategoryBuckets();

  return (
    <div className="mt-6">
      <div className="mb-3">
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
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {tab === "archived" ? (
          archivedTasks === undefined ? (
            <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
              Loading...
            </div>
          ) : archivedTasks.length === 0 ? (
            <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
              No archived tasks
            </div>
          ) : (
            archivedTasks.map((task) => (
              <TaskItem
                key={task._id}
                task={task}
                teamSlugOrId={teamSlugOrId}
              />
            ))
          )
        ) : allTasks === undefined ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
            Loading...
          </div>
        ) : (
          <div className="mt-1">
            {CATEGORY_ORDER.map((categoryKey, index) => (
              <TaskCategorySection
                key={categoryKey}
                categoryKey={categoryKey}
                tasks={categoryBuckets[categoryKey]}
                teamSlugOrId={teamSlugOrId}
                showDivider={index !== 0}
              />
            ))}
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
  showDivider,
}: {
  categoryKey: TaskCategoryKey;
  tasks: Doc<"tasks">[];
  teamSlugOrId: string;
  showDivider: boolean;
}) {
  const meta = CATEGORY_META[categoryKey];
  return (
    <div
      className={
        showDivider
          ? "pt-4 mt-4 border-t border-neutral-200 dark:border-neutral-800"
          : undefined
      }
    >
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {meta.title}
        </div>
        <div className="text-xs text-neutral-400 dark:text-neutral-500">
          {tasks.length}
        </div>
      </div>
      {tasks.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1">
          {tasks.map((task) => (
            <TaskItem
              key={task._id}
              task={task}
              teamSlugOrId={teamSlugOrId}
            />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400 select-none">
          {meta.emptyLabel}
        </p>
      )}
    </div>
  );
}
