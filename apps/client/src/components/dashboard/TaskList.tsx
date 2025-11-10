import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { useQuery } from "convex/react";
import { memo, useMemo, useState } from "react";
import { TaskItem } from "./TaskItem";

type TaskCategory = "workspaces" | "ready" | "inProgress" | "merged";

type TaskGroups = Record<TaskCategory, Doc<"tasks">[]>;

type TaskMergeStatusString =
  | "none"
  | "pr_draft"
  | "pr_open"
  | "pr_approved"
  | "pr_changes_requested"
  | "pr_merged"
  | "pr_closed"
  | undefined;

const READY_FOR_REVIEW_STATUSES = new Set<TaskMergeStatusString>([
  "pr_open",
  "pr_approved",
  "pr_changes_requested",
]);

const CATEGORY_METADATA: Record<
  TaskCategory,
  { title: string; emptyCopy: string }
> = {
  workspaces: {
    title: "Workspaces",
    emptyCopy: "Spin up a cloud or local workspace to get started.",
  },
  ready: {
    title: "Ready to review",
    emptyCopy: "Open pull requests will show up here once ready.",
  },
  inProgress: {
    title: "In progress",
    emptyCopy: "Launch an agent run to populate your in-flight tasks.",
  },
  merged: {
    title: "Merged",
    emptyCopy: "Completed tasks will land here after merge.",
  },
};

const CATEGORY_ORDER: TaskCategory[] = [
  "workspaces",
  "ready",
  "inProgress",
  "merged",
];

const createEmptyGroups = (): TaskGroups => ({
  workspaces: [],
  ready: [],
  inProgress: [],
  merged: [],
});

const categorizeTask = (task: Doc<"tasks">): TaskCategory => {
  if (task.isLocalWorkspace || task.isCloudWorkspace) {
    return "workspaces";
  }
  if (task.mergeStatus === "pr_merged") {
    return "merged";
  }
  if (READY_FOR_REVIEW_STATUSES.has(task.mergeStatus)) {
    return "ready";
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
  const groupedTasks = useMemo(() => {
    if (!tasks || tab !== "all") {
      return null;
    }
    return tasks.reduce<TaskGroups>((groups, task) => {
      groups[categorizeTask(task)].push(task);
      return groups;
    }, createEmptyGroups());
  }, [tab, tasks]);

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
        ) : tab === "archived" ? (
          tasks.length === 0 ? (
            <div className="text-sm text-neutral-500 dark:text-neutral-400 py-2 select-none">
              No archived tasks
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {tasks.map((task) => (
                <TaskItem key={task._id} task={task} teamSlugOrId={teamSlugOrId} />
              ))}
            </div>
          )
        ) : (
          groupedTasks && (
            <div className="flex flex-col gap-6">
              {CATEGORY_ORDER.map((category) => {
                const categoryTasks = groupedTasks[category];
                const { title, emptyCopy } = CATEGORY_METADATA[category];
                return (
                  <TaskCategorySection
                    key={category}
                    title={title}
                    emptyCopy={emptyCopy}
                    tasks={categoryTasks}
                    teamSlugOrId={teamSlugOrId}
                  />
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
});

interface TaskCategorySectionProps {
  title: string;
  emptyCopy: string;
  tasks: Doc<"tasks">[];
  teamSlugOrId: string;
}

function TaskCategorySection({
  title,
  emptyCopy,
  tasks,
  teamSlugOrId,
}: TaskCategorySectionProps) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {title}
        </p>
        {tasks.length > 0 ? (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {tasks.length}
          </span>
        ) : null}
      </div>
      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-200/80 dark:border-neutral-700/60 bg-white/40 dark:bg-neutral-800/30 px-3 py-4 text-sm text-neutral-500 dark:text-neutral-400">
          {emptyCopy}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {tasks.map((task) => (
            <TaskItem key={task._id} task={task} teamSlugOrId={teamSlugOrId} />
          ))}
        </div>
      )}
    </section>
  );
}
