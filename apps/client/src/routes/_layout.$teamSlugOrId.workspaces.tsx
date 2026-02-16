import { TaskTree } from "@/components/TaskTree";
import { TaskTreeSkeleton } from "@/components/TaskTreeSkeleton";
import { FloatingPane } from "@/components/floating-pane";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { isFakeConvexId } from "@/lib/fakeConvexId";
import { api } from "@cmux/convex/api";
import { type Id } from "@cmux/convex/dataModel";
import { createFileRoute } from "@tanstack/react-router";
import { usePaginatedQuery, useQueries, useQuery } from "convex/react";
import { useMemo } from "react";
import { env } from "@/client-env";
import { Loader2 } from "lucide-react";

const WORKSPACES_PAGE_SIZE = 10;

export const Route = createFileRoute("/_layout/$teamSlugOrId/workspaces")({
  component: WorkspacesRoute,
});

function WorkspacesRoute() {
  const { teamSlugOrId } = Route.useParams();
  // In web mode, exclude local workspaces
  const excludeLocalWorkspaces = env.NEXT_PUBLIC_WEB_MODE || undefined;
  // Use paginated query to reduce initial load
  const {
    results: tasks,
    status: tasksStatus,
    loadMore: loadMoreTasks,
  } = usePaginatedQuery(
    api.tasks.getWithNotificationOrderPaginated,
    { teamSlugOrId, excludeLocalWorkspaces },
    { initialNumItems: WORKSPACES_PAGE_SIZE }
  );
  const tasksWithUnread = useQuery(api.taskNotifications.getTasksWithUnread, {
    teamSlugOrId,
  });
  const { expandTaskIds } = useExpandTasks();

  // Tasks are already sorted by the query (unread notifications first)
  const orderedTasks = useMemo(
    () => tasks ?? ([] as NonNullable<typeof tasks>),
    [tasks]
  );

  // Create a Set for quick lookup of task IDs with unread notifications
  const tasksWithUnreadSet = useMemo(() => {
    if (!tasksWithUnread) return new Set<string>();
    return new Set(tasksWithUnread.map((t) => t.taskId));
  }, [tasksWithUnread]);

  const taskRunQueries = useMemo(() => {
    return orderedTasks
      .filter((task) => !isFakeConvexId(task._id))
      .reduce(
        (acc, task) => ({
          ...acc,
          [task._id]: {
            query: api.taskRuns.getByTask,
            args: { teamSlugOrId, taskId: task._id },
          },
        }),
        {} as Record<
          Id<"tasks">,
          {
            query: typeof api.taskRuns.getByTask;
            args:
              | ((d: { params: { teamSlugOrId: string } }) => {
                  teamSlugOrId: string;
                  taskId: Id<"tasks">;
                })
              | { teamSlugOrId: string; taskId: Id<"tasks"> };
          }
        >
      );
  }, [orderedTasks, teamSlugOrId]);

  const taskRunResults = useQueries(
    taskRunQueries as Parameters<typeof useQueries>[0]
  );

  const tasksWithRuns = useMemo(
    () =>
      orderedTasks.map((task) => ({
        ...task,
        runs: taskRunResults?.[task._id] ?? [],
      })),
    [orderedTasks, taskRunResults]
  );

  return (
    <FloatingPane>
      <div className="grow h-full flex flex-col">
        <div className="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 select-none">
            Workspaces
          </h1>
        </div>
        <div className="overflow-y-auto px-4 pb-6">
          {tasksStatus === "LoadingFirstPage" ? (
            <TaskTreeSkeleton count={10} />
          ) : tasksWithRuns.length === 0 ? (
            <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400 select-none">
              No workspaces yet.
            </p>
          ) : (
            <div className="mt-2 space-y-1">
              {tasksWithRuns.map((task) => (
                <TaskTree
                  key={task._id}
                  task={task}
                  defaultExpanded={expandTaskIds?.includes(task._id) ?? false}
                  teamSlugOrId={teamSlugOrId}
                  hasUnreadNotification={tasksWithUnreadSet.has(task._id)}
                />
              ))}
              {/* Load more button for pagination */}
              {tasksStatus === "CanLoadMore" && (
                <button
                  type="button"
                  onClick={() => loadMoreTasks(WORKSPACES_PAGE_SIZE)}
                  className="w-full mt-2 py-2 text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                >
                  Load more tasks...
                </button>
              )}
              {tasksStatus === "LoadingMore" && (
                <div className="flex items-center justify-center gap-2 py-2 text-sm text-neutral-500 dark:text-neutral-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading more...</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </FloatingPane>
  );
}
