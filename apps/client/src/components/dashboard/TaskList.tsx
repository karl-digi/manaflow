import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { useQuery } from "convex/react";
import { memo, useMemo, useState } from "react";
import { TaskItem } from "./TaskItem";

const CATEGORY_DEFINITIONS = [
  {
    key: "workspaces",
    title: "Workspaces",
    emptyText: "No workspace tasks",
  },
  {
    key: "readyToReview",
    title: "Ready to review",
    emptyText: "Nothing ready for review",
  },
  {
    key: "inProgress",
    title: "In progress",
    emptyText: "No tasks in progress",
  },
  {
    key: "merged",
    title: "Merged",
    emptyText: "No merged tasks",
  },
] as const;

type TaskCategory = (typeof CATEGORY_DEFINITIONS)[number]["key"];
type TaskGroups = Record<TaskCategory, Doc<"tasks">[]>;

const categorizeTask = (task: Doc<"tasks">): TaskCategory => {
  if (task.isLocalWorkspace || task.isCloudWorkspace) {
    return "workspaces";
  }

  if (task.mergeStatus === "pr_open" || task.mergeStatus === "pr_approved") {
    return "readyToReview";
  }

  if (task.mergeStatus === "pr_merged") {
    return "merged";
  }

  return "inProgress";
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
  const tasks = tab === "archived" ? archivedTasks : allTasks;
  const groupedTasks = useMemo<TaskGroups | null>(() => {
    if (!tasks) {
      return null;
    }

    const buckets: TaskGroups = {
      workspaces: [],
      readyToReview: [],
      inProgress: [],
      merged: [],
    };

    for (const task of tasks) {
      buckets[categorizeTask(task)].push(task);
    }
    return buckets;
  }, [tasks]);
  const showCategorizedView = tab === "all";

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
      <div className="flex flex-col gap-4">
        {tasks === undefined ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
            Loading...
          </div>
        ) : showCategorizedView && groupedTasks ? (
          CATEGORY_DEFINITIONS.map(({ key, title, emptyText }) => {
            const categoryTasks = groupedTasks?.[key] ?? [];
            return (
              <section key={key} className="flex flex-col gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {title}
                </div>
                <div className="flex flex-col gap-1">
                  {categoryTasks.length === 0 ? (
                    <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
                      {emptyText}
                    </div>
                  ) : (
                    categoryTasks.map((task) => (
                      <TaskItem
                        key={task._id}
                        task={task}
                        teamSlugOrId={teamSlugOrId}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })
        ) : tasks.length === 0 ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
            {tab === "all" ? "No active tasks" : "No archived tasks"}
          </div>
        ) : (
          tasks.map((task) => (
            <TaskItem key={task._id} task={task} teamSlugOrId={teamSlugOrId} />
          ))
        )}
      </div>
    </div>
  );
});
