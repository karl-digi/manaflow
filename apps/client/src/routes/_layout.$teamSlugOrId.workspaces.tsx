import { TaskTree } from "@/components/TaskTree";
import { TaskTreeSkeleton } from "@/components/TaskTreeSkeleton";
import { FloatingPane } from "@/components/floating-pane";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { Button } from "@/components/ui/button";
import { isFakeConvexId } from "@/lib/fakeConvexId";
import { dispatchCommandBarOpenEvent } from "@/lib/command-bar-events";
import { api } from "@cmux/convex/api";
import { type Id } from "@cmux/convex/dataModel";
import { convexQuery } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery } from "convex/react";
import { useCallback, useMemo } from "react";
import { Cloud, Laptop } from "lucide-react";

export const Route = createFileRoute("/_layout/$teamSlugOrId/workspaces")({
  component: WorkspacesRoute,
  loader: async ({ params }) => {
    const { teamSlugOrId } = params;
    void convexQueryClient.queryClient.ensureQueryData(
      convexQuery(api.tasks.get, { teamSlugOrId })
    );
  },
});

function WorkspacesRoute() {
  const { teamSlugOrId } = Route.useParams();
  const tasks = useQuery(api.tasks.get, { teamSlugOrId });
  const { expandTaskIds } = useExpandTasks();
  const handleAddCloudWorkspace = useCallback(() => {
    dispatchCommandBarOpenEvent({
      page: "cloud-workspaces",
      resetSearch: true,
    });
  }, []);

  const handleAddLocalWorkspace = useCallback(() => {
    dispatchCommandBarOpenEvent({
      page: "local-workspaces",
      resetSearch: true,
    });
  }, []);

  const orderedTasks = useMemo(() => {
    if (!tasks) return [] as NonNullable<typeof tasks>;
    return [...tasks].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [tasks]);

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
        <div className="border-b border-neutral-200 px-6 py-5 dark:border-neutral-800">
          <div className="space-y-1 max-w-2xl">
            <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 select-none">
              Workspaces
            </h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Start a new workspace without leaving this page. Pick cloud for
              Morph-hosted environments, or stay local when you want everything
              on your laptop.
            </p>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-sky-100/80 bg-sky-50/80 p-4 shadow-sm dark:border-sky-500/30 dark:bg-sky-500/5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-sky-700 dark:bg-sky-500/30 dark:text-sky-200">
                      Cloud
                    </span>
                  </div>
                  <h2 className="mt-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
                    Add Cloud Workspace
                  </h2>
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                    Morph hosts and resumes the workspace for you so every
                    teammate lands in the same reproducible environment.
                  </p>
                </div>
                <span className="rounded-full bg-white/80 p-2 text-sky-500 shadow-sm dark:bg-sky-500/10 dark:text-sky-200">
                  <Cloud className="h-5 w-5" />
                </span>
              </div>
              <div className="mt-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
                <div className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-sky-500" />
                  <p>Provision heavy builds without taxing your laptop.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-sky-500" />
                  <p>Share browser-based VS Code links instantly.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-sky-500" />
                  <p>Great for long-lived maintenance and on-call runs.</p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                className="mt-4 w-full sm:w-auto"
                onClick={handleAddCloudWorkspace}
              >
                Add Cloud Workspace
              </Button>
            </div>
            <div className="rounded-2xl border border-amber-100/80 bg-amber-50/80 p-4 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/30 dark:text-amber-200">
                      Local
                    </span>
                  </div>
                  <h2 className="mt-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
                    Add Local Workspace
                  </h2>
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                    Clone to your machine and keep your existing editor,
                    tooling, and secrets without syncing anything to the cloud.
                  </p>
                </div>
                <span className="rounded-full bg-white/80 p-2 text-amber-500 shadow-sm dark:bg-amber-500/10 dark:text-amber-200">
                  <Laptop className="h-5 w-5" />
                </span>
              </div>
              <div className="mt-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
                <div className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <p>Works offline and taps into your local dotfiles.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <p>Keep proprietary data, keys, or hardware access local.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <p>Perfect when you need to iterate with your own IDE setup.</p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-4 w-full sm:w-auto border-amber-200 text-amber-800 hover:bg-amber-100/60 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/10"
                onClick={handleAddLocalWorkspace}
              >
                Add Local Workspace
              </Button>
            </div>
          </div>
        </div>
        <div className="overflow-y-auto px-4 pb-6">
          {tasks === undefined ? (
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
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </FloatingPane>
  );
}
