import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import { useSocket } from "@/contexts/socket/use-socket";
import { cleanupTaskRunIframes } from "@/lib/persistent-webview-keys";
import { morphPauseQueryKey } from "@/hooks/useMorphWorkspace";
import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { queryClient } from "@/query-client";

type TaskRunWithVSCode = {
  _id: Id<"taskRuns">;
  vscode?: { workspaceUrl?: string | null } | null;
  children?: TaskRunWithVSCode[];
};

/**
 * Clean up all cached iframes and cancel terminal session queries for a task's runs.
 * This prevents Wake on HTTP from being triggered by:
 * 1. Cached iframes still in the DOM making HTTP requests to paused VMs
 * 2. React Query's refetchInterval polling terminal sessions
 */
async function cleanupTaskResources(
  teamSlugOrId: string,
  taskId: Id<"tasks">
): Promise<void> {
  try {
    // Query task runs from the Convex query client cache or fetch if needed
    const taskRunsQueryKey = convexQuery(api.taskRuns.getByTask, {
      teamSlugOrId,
      taskId,
    }).queryKey;

    const cachedRuns = convexQueryClient.queryClient.getQueryData<TaskRunWithVSCode[]>(
      taskRunsQueryKey
    );

    if (!cachedRuns) {
      // No cached runs, nothing to clean up
      return;
    }

    // Recursively collect all runs (including children)
    const collectRuns = (runs: TaskRunWithVSCode[]): TaskRunWithVSCode[] => {
      const allRuns: TaskRunWithVSCode[] = [];
      for (const run of runs) {
        allRuns.push(run);
        if (run.children?.length) {
          allRuns.push(...collectRuns(run.children));
        }
      }
      return allRuns;
    };

    const allRuns = collectRuns(cachedRuns);

    // Clean up iframes for each run
    for (const run of allRuns) {
      cleanupTaskRunIframes(run._id);
    }

    // Cancel all terminal-tabs queries that might be polling the VM
    // The query key format is: ["terminal-tabs", contextKey, baseUrl, "list"]
    // We need to cancel queries matching any of the task's workspace URLs
    await queryClient.cancelQueries({
      predicate: (query) => {
        if (!Array.isArray(query.queryKey)) return false;
        if (query.queryKey[0] !== "terminal-tabs") return false;

        // Check if the contextKey (query.queryKey[1]) matches any of our run IDs
        const contextKey = query.queryKey[1];
        if (typeof contextKey !== "string") return false;

        // The contextKey could be the runId or workspaceUrl
        // Check both to be safe
        return allRuns.some(
          (run) =>
            contextKey === run._id ||
            contextKey === run.vscode?.workspaceUrl
        );
      },
    });

    // Also remove these queries from cache to stop refetchInterval from restarting them
    queryClient.removeQueries({
      predicate: (query) => {
        if (!Array.isArray(query.queryKey)) return false;
        if (query.queryKey[0] !== "terminal-tabs") return false;

        const contextKey = query.queryKey[1];
        if (typeof contextKey !== "string") return false;

        return allRuns.some(
          (run) =>
            contextKey === run._id ||
            contextKey === run.vscode?.workspaceUrl
        );
      },
    });
  } catch (error) {
    console.error("[useArchiveTask] Failed to cleanup task resources:", error);
  }
}

/**
 * Invalidate only the morph pause queries for a specific task's runs.
 * This is more targeted than invalidating all morph queries, which would
 * trigger HTTP requests to other tasks' VMs (triggering Wake on HTTP).
 */
function invalidateMorphPauseQueriesForTask(
  teamSlugOrId: string,
  taskId: Id<"tasks">
): void {
  try {
    const taskRunsQueryKey = convexQuery(api.taskRuns.getByTask, {
      teamSlugOrId,
      taskId,
    }).queryKey;

    const cachedRuns = convexQueryClient.queryClient.getQueryData<TaskRunWithVSCode[]>(
      taskRunsQueryKey
    );

    if (!cachedRuns?.length) {
      return;
    }

    // Recursively collect all runs (including children)
    const collectRunIds = (runs: TaskRunWithVSCode[]): Id<"taskRuns">[] => {
      const allIds: Id<"taskRuns">[] = [];
      for (const run of runs) {
        allIds.push(run._id);
        if (run.children?.length) {
          allIds.push(...collectRunIds(run.children));
        }
      }
      return allIds;
    };

    const runIds = collectRunIds(cachedRuns);

    // Invalidate only the specific morph pause queries for this task's runs
    for (const runId of runIds) {
      void queryClient.invalidateQueries({
        queryKey: morphPauseQueryKey(runId, teamSlugOrId),
      });
    }
  } catch (error) {
    console.error("[useArchiveTask] Failed to invalidate morph queries:", error);
  }
}

export function useArchiveTask(teamSlugOrId: string) {
  const { socket } = useSocket();

  type TasksGetArgs = {
    teamSlugOrId: string;
    projectFullName?: string;
    archived?: boolean;
  };

  const archiveMutation = useMutation(api.tasks.archive).withOptimisticUpdate(
    (localStore, args) => {
      const updateLists = (keyArgs: TasksGetArgs) => {
        const active = localStore.getQuery(api.tasks.get, keyArgs);
        if (!active) return;
        const idx = active.findIndex((t) => t._id === args.id);
        if (idx >= 0) {
          const [task] = active.splice(idx, 1);
          // Try to also update the archived list if present in store
          const archivedArgs: TasksGetArgs = { ...keyArgs, archived: true };
          const archived = localStore.getQuery(api.tasks.get, archivedArgs);
          if (archived !== undefined && task) {
            localStore.setQuery(api.tasks.get, archivedArgs, [
              { ...task, isArchived: true },
              ...archived,
            ]);
          }
          localStore.setQuery(api.tasks.get, keyArgs, [...active]);
        }
      };
      // default args variant used across app
      updateLists({ teamSlugOrId });
      updateLists({ teamSlugOrId, archived: false });

      // Also update getById query if it exists (used by preview list)
      const detailArgs = { teamSlugOrId: args.teamSlugOrId, id: args.id };
      const existingDetail = localStore.getQuery(api.tasks.getById, detailArgs);
      if (existingDetail) {
        localStore.setQuery(api.tasks.getById, detailArgs, {
          ...existingDetail,
          isArchived: true,
        });
      }

      // Also update getPreviewTasks query if it exists (used by sidebar previews)
      const previewArgs = { teamSlugOrId: args.teamSlugOrId };
      const previewTasks = localStore.getQuery(
        api.tasks.getPreviewTasks,
        previewArgs
      );
      if (previewTasks) {
        localStore.setQuery(
          api.tasks.getPreviewTasks,
          previewArgs,
          previewTasks.filter((t) => t._id !== args.id)
        );
      }

      // Also update previewRuns.listByTeam query if it exists (used by dashboard previews tab)
      const previewRunsArgs = { teamSlugOrId: args.teamSlugOrId };
      const previewRuns = localStore.getQuery(
        api.previewRuns.listByTeam,
        previewRunsArgs
      );
      if (previewRuns) {
        localStore.setQuery(
          api.previewRuns.listByTeam,
          previewRunsArgs,
          previewRuns.filter((run) => run.taskId !== args.id)
        );
      }

      // Also update getPinned query if it exists (used by sidebar pinned section)
      const pinnedArgs = { teamSlugOrId: args.teamSlugOrId };
      const pinnedTasks = localStore.getQuery(api.tasks.getPinned, pinnedArgs);
      if (pinnedTasks) {
        localStore.setQuery(
          api.tasks.getPinned,
          pinnedArgs,
          pinnedTasks.filter((t) => t._id !== args.id)
        );
      }
    }
  );

  const unarchiveMutation = useMutation(
    api.tasks.unarchive
  ).withOptimisticUpdate((localStore, args) => {
    const updateLists = (keyArgs: TasksGetArgs) => {
      const archivedArgs: TasksGetArgs = { ...keyArgs, archived: true };
      const archived = localStore.getQuery(api.tasks.get, archivedArgs);
      if (!archived) return;
      const idx = archived.findIndex((t) => t._id === args.id);
      if (idx >= 0) {
        const [task] = archived.splice(idx, 1);
        const active = localStore.getQuery(api.tasks.get, keyArgs);
        if (active !== undefined && task) {
          localStore.setQuery(api.tasks.get, keyArgs, [
            { ...task, isArchived: false },
            ...active,
          ]);
        }
        localStore.setQuery(api.tasks.get, archivedArgs, [...archived]);
      }
    };
    updateLists({ teamSlugOrId });
    updateLists({ teamSlugOrId, archived: false });

    // Also update getById query if it exists (used by preview list)
    const detailArgs = { teamSlugOrId: args.teamSlugOrId, id: args.id };
    const existingDetail = localStore.getQuery(api.tasks.getById, detailArgs);
    if (existingDetail) {
      localStore.setQuery(api.tasks.getById, detailArgs, {
        ...existingDetail,
        isArchived: false,
      });
    }
  });

  // Helper to update React Query cache (used alongside Convex optimistic updates)
  // The layout uses convexQuery wrapper with React Query, which has a separate cache
  const invalidateReactQueryCache = (taskId: Doc<"tasks">["_id"]) => {
    const queryClient = convexQueryClient.queryClient;

    // Get current tasks from React Query cache and filter out the archived task
    const tasksQueryKey = convexQuery(api.tasks.get, {
      teamSlugOrId,
      archived: false,
    }).queryKey;
    const currentTasks = queryClient.getQueryData<Doc<"tasks">[]>(tasksQueryKey);
    if (currentTasks) {
      queryClient.setQueryData(
        tasksQueryKey,
        currentTasks.filter((t) => t._id !== taskId)
      );
    }

    // Also update the variant without explicit archived: false (used by workspaces)
    const tasksQueryKeyNoArchived = convexQuery(api.tasks.get, {
      teamSlugOrId,
    }).queryKey;
    const currentTasksNoArchived =
      queryClient.getQueryData<Doc<"tasks">[]>(tasksQueryKeyNoArchived);
    if (currentTasksNoArchived) {
      queryClient.setQueryData(
        tasksQueryKeyNoArchived,
        currentTasksNoArchived.filter((t) => t._id !== taskId)
      );
    }
  };

  const archiveWithUndo = (task: Doc<"tasks">) => {
    archiveMutation({ teamSlugOrId, id: task._id });
    invalidateReactQueryCache(task._id);

    // Clean up cached iframes and terminal queries to prevent Wake on HTTP
    void cleanupTaskResources(teamSlugOrId, task._id);

    // Emit socket event to stop/pause containers
    if (socket) {
      socket.emit(
        "archive-task",
        { taskId: task._id },
        (response: { success: boolean; error?: string }) => {
          if (!response.success) {
            console.error("Failed to stop containers:", response.error);
          }
        }
      );
    }

    toast("Task archived", {
      action: {
        label: "Undo",
        onClick: () => {
          unarchiveMutation({ teamSlugOrId, id: task._id });
          // Emit socket event to resume containers
          if (socket) {
            socket.emit(
              "unarchive-task",
              { taskId: task._id },
              (response: { success: boolean; error?: string }) => {
                if (!response.success) {
                  console.error("Failed to resume containers:", response.error);
                } else {
                  // Invalidate only this task's morph pause queries to trigger iframe refresh
                  // Using targeted invalidation prevents waking other tasks' VMs via Wake on HTTP
                  invalidateMorphPauseQueriesForTask(teamSlugOrId, task._id);
                }
              }
            );
          }
        },
      },
    });
  };

  const archive = (id: string) => {
    archiveMutation({
      teamSlugOrId,
      id: id as Doc<"tasks">["_id"],
    });
    invalidateReactQueryCache(id as Doc<"tasks">["_id"]);

    // Clean up cached iframes and terminal queries to prevent Wake on HTTP
    void cleanupTaskResources(teamSlugOrId, id as Id<"tasks">);

    // Emit socket event to stop/pause containers
    if (socket) {
      socket.emit(
        "archive-task",
        { taskId: id as Doc<"tasks">["_id"] },
        (response: { success: boolean; error?: string }) => {
          if (!response.success) {
            console.error("Failed to stop containers:", response.error);
          }
        }
      );
    }
  };

  const unarchive = (id: string) => {
    const taskId = id as Id<"tasks">;
    unarchiveMutation({
      teamSlugOrId,
      id: taskId,
    });

    // Emit socket event to resume containers
    if (socket) {
      socket.emit(
        "unarchive-task",
        { taskId },
        (response: { success: boolean; error?: string }) => {
          if (!response.success) {
            console.error("Failed to resume containers:", response.error);
          } else {
            // Invalidate only this task's morph pause queries to trigger iframe refresh
            // Using targeted invalidation prevents waking other tasks' VMs via Wake on HTTP
            invalidateMorphPauseQueriesForTask(teamSlugOrId, taskId);
          }
        }
      );
    }
  };

  return {
    archive,
    unarchive,
    archiveWithUndo,
  };
}
