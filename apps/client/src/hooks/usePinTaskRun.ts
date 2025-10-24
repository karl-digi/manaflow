import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { useMutation } from "convex/react";

type GetByTaskArgs = {
  teamSlugOrId: string;
  taskId: Id<"tasks">;
};

type TaskRunTree = typeof api.taskRuns.getByTask._returnType;
type TaskRunTreeItem = TaskRunTree[number];

const stripRun = (run: TaskRunTreeItem): Doc<"taskRuns"> => {
  const { children: _children, environment: _environment, ...rest } = run;
  return rest as Doc<"taskRuns">;
};

export function usePinTaskRun(teamSlugOrId: string) {
  const mutation = useMutation(api.taskRuns.setPinned).withOptimisticUpdate(
    (localStore, args) => {
      const pinnedAt = args.isPinned ? Date.now() : undefined;
      let optimisticRun: Doc<"taskRuns"> | undefined;

      const updateRuns = (runs: TaskRunTree): TaskRunTree => {
        let modified = false;
        const nextRuns = runs.map((run) => {
          const updatedChildren =
            run.children.length > 0 ? updateRuns(run.children) : run.children;
          if (updatedChildren !== run.children) {
            modified = true;
          }
          if (run._id !== args.id) {
            return updatedChildren !== run.children
              ? { ...run, children: updatedChildren }
              : run;
          }

          modified = true;
          const next: TaskRunTreeItem = {
            ...run,
            isPinned: args.isPinned,
            pinnedAt,
            children: updatedChildren,
          };
          optimisticRun = stripRun(next);
          return next;
        });

        return modified ? nextRuns : runs;
      };

      const keyArgs: GetByTaskArgs = {
        teamSlugOrId,
        taskId: args.taskId,
      };
      const runs = localStore.getQuery(api.taskRuns.getByTask, keyArgs);
      if (runs) {
        const updatedRuns = updateRuns(runs);
        if (updatedRuns !== runs) {
          localStore.setQuery(api.taskRuns.getByTask, keyArgs, updatedRuns);
        }
      }

      const pinnedArgs = { teamSlugOrId };
      const pinnedRuns = localStore.getQuery(api.taskRuns.getPinned, pinnedArgs);
      if (pinnedRuns === undefined) {
        return;
      }

      const withoutCurrent = pinnedRuns.filter((run) => run._id !== args.id);
      if (!args.isPinned) {
        localStore.setQuery(api.taskRuns.getPinned, pinnedArgs, withoutCurrent);
        return;
      }

      if (!optimisticRun) {
        return;
      }

      const taskSources: Doc<"tasks">[][] = [
        localStore.getQuery(api.tasks.get, { teamSlugOrId }) ?? [],
        localStore.getQuery(api.tasks.get, {
          teamSlugOrId,
          archived: false,
        }) ?? [],
        localStore.getQuery(api.tasks.get, {
          teamSlugOrId,
          archived: true,
        }) ?? [],
        localStore.getQuery(api.tasks.getPinned, { teamSlugOrId }) ?? [],
      ];

      let taskDoc: Doc<"tasks"> | undefined;
      for (const source of taskSources) {
        taskDoc = source.find((task) => task._id === args.taskId);
        if (taskDoc) {
          break;
        }
      }

      if (!taskDoc) {
        return;
      }

      localStore.setQuery(api.taskRuns.getPinned, pinnedArgs, [
        {
          ...optimisticRun,
          isPinned: true,
          pinnedAt,
          task: taskDoc,
        },
        ...withoutCurrent,
      ]);
    },
  );

  const setPinned = (
    id: Doc<"taskRuns">["_id"],
    taskId: Id<"tasks">,
    isPinned: boolean,
  ) =>
    mutation({
      teamSlugOrId,
      id,
      taskId,
      isPinned,
    });

  return { setPinned };
}
