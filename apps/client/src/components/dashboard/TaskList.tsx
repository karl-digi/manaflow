import { api } from "@cmux/convex/api";
import { useQuery } from "convex/react";
import { memo, useMemo, useState } from "react";
import { PinnedTaskRunItem } from "./PinnedTaskRunItem";
import { TaskItem } from "./TaskItem";

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
  const pinnedTaskRuns = useQuery(
    api.taskRuns.getPinned,
    tab === "archived" ? "skip" : { teamSlugOrId },
  );
  const tasks = tab === "archived" ? archivedTasks : allTasks;

  const pinnedTaskIds = useMemo(() => {
    if (!allTasks) {
      return new Set<string>();
    }
    return new Set(allTasks.filter((task) => task.isPinned).map((task) => task._id));
  }, [allTasks]);

  const displayItems = useMemo(() => {
    if (!tasks) {
      return null;
    }

    if (tab === "archived") {
      return tasks.map((task) => ({
        kind: "task" as const,
        task,
      }));
    }

    const pinnedItems = [];
    if (allTasks) {
      for (const task of allTasks) {
        if (task.isPinned) {
          pinnedItems.push({
            kind: "task" as const,
            pinnedAt: task.pinnedAt ?? task.updatedAt ?? 0,
            task,
          });
        }
      }
    }

    if (pinnedTaskRuns) {
      for (const run of pinnedTaskRuns) {
        pinnedItems.push({
          kind: "run" as const,
          pinnedAt: run.pinnedAt ?? run.updatedAt ?? 0,
          run,
        });
      }
    }

    pinnedItems.sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));

    const remainingTasks = tasks.filter((task) => !pinnedTaskIds.has(task._id));
    const remainingItems = remainingTasks.map((task) => ({
      kind: "task" as const,
      task,
    }));

    return [...pinnedItems, ...remainingItems];
  }, [allTasks, pinnedTaskRuns, pinnedTaskIds, tab, tasks]);

  const isLoading =
    tasks === undefined ||
    (tab === "all" && pinnedTaskRuns === undefined);

  const emptyMessage =
    tab === "all" ? "No active tasks" : "No archived tasks";

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
        {isLoading ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
            Loading...
          </div>
        ) : !displayItems || displayItems.length === 0 ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
            {emptyMessage}
          </div>
        ) : (
          displayItems.map((item) =>
            item.kind === "task" ? (
              <TaskItem
                key={item.task._id}
                task={item.task}
                teamSlugOrId={teamSlugOrId}
              />
            ) : (
              <PinnedTaskRunItem
                key={item.run._id}
                item={item.run}
                teamSlugOrId={teamSlugOrId}
              />
            ),
          )
        )}
      </div>
    </div>
  );
});
