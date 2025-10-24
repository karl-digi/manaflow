import { useSocket } from "@/contexts/socket/use-socket";
import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { useMutation } from "convex/react";
import { toast } from "sonner";

type TaskRunTree = typeof api.taskRuns.getByTask._returnType;
type TaskRunTreeItem = TaskRunTree[number];

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
              {
                ...task,
                isArchived: true,
                isPinned: false,
                pinnedAt: undefined,
              },
              ...archived,
            ]);
          }
          localStore.setQuery(api.tasks.get, keyArgs, [...active]);
        }
      };
      // default args variant used across app
      updateLists({ teamSlugOrId });
      updateLists({ teamSlugOrId, archived: false });

      const pinnedArgs = { teamSlugOrId };
      const pinned = localStore.getQuery(api.tasks.getPinned, pinnedArgs);
      if (pinned !== undefined) {
        localStore.setQuery(
          api.tasks.getPinned,
          pinnedArgs,
          pinned.filter((task) => task._id !== args.id),
        );
      }

      const pinnedRunsArgs = { teamSlugOrId };
      const pinnedRuns = localStore.getQuery(
        api.taskRuns.getPinned,
        pinnedRunsArgs,
      );
      if (pinnedRuns !== undefined) {
        localStore.setQuery(
          api.taskRuns.getPinned,
          pinnedRunsArgs,
          pinnedRuns.filter((run) => run.taskId !== args.id),
        );
      }

      const taskRunsArgs = { teamSlugOrId, taskId: args.id };
      const runsForTask = localStore.getQuery(
        api.taskRuns.getByTask,
        taskRunsArgs,
      );
      if (runsForTask) {
        const resetPinned = (run: TaskRunTreeItem): TaskRunTreeItem => ({
          ...run,
          isPinned: false,
          pinnedAt: undefined,
          children: run.children.map(resetPinned),
        });
        localStore.setQuery(
          api.taskRuns.getByTask,
          taskRunsArgs,
          runsForTask.map(resetPinned),
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
  });

  const archiveWithUndo = (task: Doc<"tasks">) => {
    archiveMutation({ teamSlugOrId, id: task._id });

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
        onClick: () => unarchiveMutation({ teamSlugOrId, id: task._id }),
      },
    });
  };

  const archive = (id: string) => {
    archiveMutation({
      teamSlugOrId,
      id: id as Doc<"tasks">["_id"],
    });

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

  return {
    archive,
    unarchive: (id: string) =>
      unarchiveMutation({
        teamSlugOrId,
        id: id as Doc<"tasks">["_id"],
      }),
    archiveWithUndo,
  };
}
