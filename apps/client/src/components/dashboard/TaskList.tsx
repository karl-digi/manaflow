import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { useQuery } from "convex/react";
import { memo, useMemo, useState } from "react";
import { TaskItem } from "./TaskItem";

type TaskSectionKey = "ready" | "working" | "merged" | "closed";

const TASK_SECTIONS: { key: TaskSectionKey; title: string }[] = [
  { key: "ready", title: "Ready to review" },
  { key: "working", title: "Working" },
  { key: "merged", title: "Merged" },
  { key: "closed", title: "Closed" },
];

const getTaskSection = (task: Doc<"tasks">): TaskSectionKey => {
  switch (task.mergeStatus) {
    case "pr_open":
    case "pr_approved":
      return "ready";
    case "pr_merged":
      return "merged";
    case "pr_closed":
      return "closed";
    default:
      return "working";
  }
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
  const groupedTasks = useMemo(() => {
    const initial: Record<TaskSectionKey, Doc<"tasks">[]> = {
      ready: [],
      working: [],
      merged: [],
      closed: [],
    };

    if (!tasks) {
      return initial;
    }

    return tasks.reduce<Record<TaskSectionKey, Doc<"tasks">[]>>(
      (acc, task) => {
        acc[getTaskSection(task)].push(task);
        return acc;
      },
      initial,
    );
  }, [tasks]);

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
        ) : tasks.length === 0 ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
            {tab === "all" ? "No active tasks" : "No archived tasks"}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {TASK_SECTIONS.map((section) => {
              const sectionTasks = groupedTasks[section.key];
              const hasTasksInSection = sectionTasks.length > 0;

              return (
                <div key={section.key} className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    {section.title}
                  </div>
                  {hasTasksInSection ? (
                    <div className="flex flex-col gap-1">
                      {sectionTasks.map((task) => (
                        <TaskItem
                          key={task._id}
                          task={task}
                          teamSlugOrId={teamSlugOrId}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-neutral-500 dark:text-neutral-400 py-1 select-none">
                      No tasks in this section
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
