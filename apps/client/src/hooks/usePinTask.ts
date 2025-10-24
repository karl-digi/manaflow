import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { useMutation } from "convex/react";

type TasksGetArgs = {
  teamSlugOrId: string;
  projectFullName?: string;
  archived?: boolean;
};

export function usePinTask(teamSlugOrId: string) {
  const mutation = useMutation(api.tasks.setPinned).withOptimisticUpdate(
    (localStore, args) => {
      const pinnedAt = args.isPinned ? Date.now() : undefined;
      let optimisticTask: Doc<"tasks"> | undefined;

      const updateList = (keyArgs: TasksGetArgs) => {
        const tasks = localStore.getQuery(api.tasks.get, keyArgs);
        if (!tasks) {
          return;
        }

        const updated = tasks.map((task) => {
          if (task._id !== args.id) {
            return task;
          }
          const next: Doc<"tasks"> = {
            ...task,
            isPinned: args.isPinned,
            pinnedAt,
            isArchived: args.isPinned ? false : task.isArchived,
          };
          optimisticTask = next;
          return next;
        });
        localStore.setQuery(api.tasks.get, keyArgs, updated);
      };

      updateList({ teamSlugOrId });
      updateList({ teamSlugOrId, archived: false });
      updateList({ teamSlugOrId, archived: true });

      const pinnedArgs = { teamSlugOrId };
      const pinned = localStore.getQuery(api.tasks.getPinned, pinnedArgs);
      if (pinned === undefined) {
        return;
      }

      const withoutCurrent = pinned.filter((task) => task._id !== args.id);
      if (!args.isPinned) {
        localStore.setQuery(api.tasks.getPinned, pinnedArgs, withoutCurrent);
        return;
      }

      if (!optimisticTask) {
        return;
      }

      localStore.setQuery(api.tasks.getPinned, pinnedArgs, [
        {
          ...optimisticTask,
          isPinned: true,
          pinnedAt,
        },
        ...withoutCurrent,
      ]);
    },
  );

  const setPinned = (id: Doc<"tasks">["_id"], isPinned: boolean) =>
    mutation({
      teamSlugOrId,
      id,
      isPinned,
    });

  return { setPinned };
}
