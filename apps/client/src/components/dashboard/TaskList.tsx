import { api } from "@cmux/convex/api";
import { useQuery } from "convex/react";
import { memo, useMemo } from "react";
import { TaskItem } from "./TaskItem";
import type { Doc } from "@cmux/convex/dataModel";

export const TaskList = memo(function TaskList({
  teamSlugOrId,
}: {
  teamSlugOrId: string;
}) {
  const allTasks = useQuery(api.tasks.get, { teamSlugOrId });

  // Organize tasks into sections based on mergeStatus
  const sections = useMemo(() => {
    if (!allTasks) return null;

    const readyToReview: Doc<"tasks">[] = [];
    const working: Doc<"tasks">[] = [];
    const merged: Doc<"tasks">[] = [];
    const closed: Doc<"tasks">[] = [];

    allTasks.forEach((task) => {
      const status = task.mergeStatus;

      if (status === "pr_merged") {
        merged.push(task);
      } else if (status === "pr_closed" || status === "pr_changes_requested") {
        closed.push(task);
      } else if (status === "pr_open" || status === "pr_approved") {
        readyToReview.push(task);
      } else {
        // "none", "pr_draft", or undefined - actively being worked on
        working.push(task);
      }
    });

    return { readyToReview, working, merged, closed };
  }, [allTasks]);

  const renderSection = (title: string, tasks: Doc<"tasks">[]) => {
    if (tasks.length === 0) return null;

    return (
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-2 px-1">
          {title} ({tasks.length})
        </h3>
        <div className="flex flex-col gap-1">
          {tasks.map((task) => (
            <TaskItem key={task._id} task={task} teamSlugOrId={teamSlugOrId} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="mt-6">
      {sections === null ? (
        <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
          Loading...
        </div>
      ) : (
        <>
          {renderSection("Ready to review", sections.readyToReview)}
          {renderSection("Working", sections.working)}
          {renderSection("Merged", sections.merged)}
          {renderSection("Closed", sections.closed)}
          {sections.readyToReview.length === 0 &&
            sections.working.length === 0 &&
            sections.merged.length === 0 &&
            sections.closed.length === 0 && (
              <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
                No tasks yet
              </div>
            )}
        </>
      )}
    </div>
  );
});
