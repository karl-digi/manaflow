import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { useQuery } from "convex/react";
import { memo, useMemo, useState } from "react";
import { TaskItem } from "./TaskItem";

type SectionKey = "ready" | "working" | "merged" | "closed";

type CategorizedTasks = Record<SectionKey, Doc<"tasks">[]>;

interface SectionDefinition {
  key: SectionKey;
  title: string;
  emptyLabel: string;
  tasks: Doc<"tasks">[];
}

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

  const categorizedActiveTasks = useMemo<CategorizedTasks | null>(() => {
    if (allTasks === undefined) {
      return null;
    }

    return allTasks.reduce<CategorizedTasks>(
      (acc, task) => {
        const status = task.mergeStatus;
        if (status === "pr_open" || status === "pr_approved") {
          acc.ready.push(task);
        } else if (status === "pr_merged") {
          acc.merged.push(task);
        } else if (status === "pr_closed") {
          acc.closed.push(task);
        } else {
          acc.working.push(task);
        }
        return acc;
      },
      { ready: [], working: [], merged: [], closed: [] },
    );
  }, [allTasks]);

  const taskSections = useMemo<SectionDefinition[] | null>(() => {
    if (!categorizedActiveTasks) {
      return null;
    }

    return [
      {
        key: "ready",
        title: "Ready to review",
        emptyLabel: "No tasks waiting for review.",
        tasks: categorizedActiveTasks.ready,
      },
      {
        key: "working",
        title: "Working",
        emptyLabel: "No tasks in progress.",
        tasks: categorizedActiveTasks.working,
      },
      {
        key: "merged",
        title: "Merged",
        emptyLabel: "No merged tasks.",
        tasks: categorizedActiveTasks.merged,
      },
      {
        key: "closed",
        title: "Closed",
        emptyLabel: "No closed tasks.",
        tasks: categorizedActiveTasks.closed,
      },
    ];
  }, [categorizedActiveTasks]);

  const activeSectionsContent = taskSections
    ? (
        <div className="space-y-6">
          {taskSections.map((section) => (
            <div key={section.key} className="space-y-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                {section.title}
              </div>
              {section.tasks.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {section.tasks.map((task) => (
                    <TaskItem key={task._id} task={task} teamSlugOrId={teamSlugOrId} />
                  ))}
                </div>
              ) : (
                <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
                  {section.emptyLabel}
                </div>
              )}
            </div>
          ))}
        </div>
      )
    : null;

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
        {tasks === undefined ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
            Loading...
          </div>
        ) : tab === "archived" ? (
          tasks.length === 0 ? (
            <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
              No archived tasks
            </div>
          ) : (
            tasks.map((task) => (
              <TaskItem key={task._id} task={task} teamSlugOrId={teamSlugOrId} />
            ))
          )
        ) : tasks.length === 0 ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
            No active tasks
          </div>
        ) : (
          activeSectionsContent
        )}
      </div>
    </div>
  );
});
