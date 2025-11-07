import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { useQuery } from "convex/react";
import { memo, useMemo, useState } from "react";
import { TaskItem } from "./TaskItem";

type TaskSection = {
  title: string;
  tasks: Doc<"tasks">[];
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

  // Organize tasks into sections based on mergeStatus
  const sections = useMemo<TaskSection[]>(() => {
    if (!tasks || tasks.length === 0) {
      return [];
    }

    const readyToReview: Doc<"tasks">[] = [];
    const working: Doc<"tasks">[] = [];
    const merged: Doc<"tasks">[] = [];
    const closed: Doc<"tasks">[] = [];

    tasks.forEach((task) => {
      const status = task.mergeStatus;

      if (status === "pr_open" || status === "pr_approved" || status === "pr_changes_requested" || status === "pr_draft") {
        readyToReview.push(task);
      } else if (status === "pr_merged") {
        merged.push(task);
      } else if (status === "pr_closed") {
        closed.push(task);
      } else {
        // No PR activity yet or status is "none" - task is still being worked on
        working.push(task);
      }
    });

    const result: TaskSection[] = [];

    if (readyToReview.length > 0) {
      result.push({ title: "Ready to review", tasks: readyToReview });
    }
    if (working.length > 0) {
      result.push({ title: "Working", tasks: working });
    }
    if (merged.length > 0) {
      result.push({ title: "Merged", tasks: merged });
    }
    if (closed.length > 0) {
      result.push({ title: "Closed", tasks: closed });
    }

    return result;
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
      <div className="flex flex-col gap-4">
        {tasks === undefined ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
            Loading...
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
            {tab === "all" ? "No active tasks" : "No archived tasks"}
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.title} className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 uppercase tracking-wider px-1 mb-1">
                {section.title}
              </h3>
              <div className="flex flex-col gap-1">
                {section.tasks.map((task) => (
                  <TaskItem key={task._id} task={task} teamSlugOrId={teamSlugOrId} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
});
