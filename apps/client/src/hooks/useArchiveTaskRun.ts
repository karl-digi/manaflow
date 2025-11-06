import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import type { TaskRunWithChildren } from "@/types/task";

export function useArchiveTaskRun(teamSlugOrId: string) {
  const archiveMutation = useMutation(
    api.taskRuns.archive
  ).withOptimisticUpdate((localStore, args) => {
    // Find all queries that might have this task run
    // and update them optimistically
    const allQueries = localStore.getAllQueries(api.taskRuns.getByTask);
    for (const { args: queryArgs, value } of allQueries) {
      if (
        queryArgs &&
        value !== undefined &&
        queryArgs.teamSlugOrId === teamSlugOrId
      ) {
        const updatedRuns = updateRunInTree(
          value as TaskRunWithChildren[],
          args.id,
          {
            isArchived: true,
          }
        );
        localStore.setQuery(
          api.taskRuns.getByTask,
          queryArgs,
          updatedRuns as typeof value
        );
      }
    }
  });

  const unarchiveMutation = useMutation(
    api.taskRuns.unarchive
  ).withOptimisticUpdate((localStore, args) => {
    const allQueries = localStore.getAllQueries(api.taskRuns.getByTask);
    for (const { args: queryArgs, value } of allQueries) {
      if (
        queryArgs &&
        value !== undefined &&
        queryArgs.teamSlugOrId === teamSlugOrId
      ) {
        const updatedRuns = updateRunInTree(
          value as TaskRunWithChildren[],
          args.id,
          {
            isArchived: false,
          }
        );
        localStore.setQuery(
          api.taskRuns.getByTask,
          queryArgs,
          updatedRuns as typeof value
        );
      }
    }
  });

  const archiveWithUndo = (run: Doc<"taskRuns">) => {
    archiveMutation({ teamSlugOrId, id: run._id });

    toast("Task run archived", {
      action: {
        label: "Undo",
        onClick: () => unarchiveMutation({ teamSlugOrId, id: run._id }),
      },
    });
  };

  const archive = (id: Id<"taskRuns">) => {
    archiveMutation({
      teamSlugOrId,
      id,
    });
  };

  const unarchive = (id: Id<"taskRuns">) => {
    unarchiveMutation({
      teamSlugOrId,
      id,
    });
  };

  return {
    archive,
    unarchive,
    archiveWithUndo,
  };
}

// Helper function to recursively update a run in the tree structure
function updateRunInTree(
  runs: TaskRunWithChildren[],
  runId: Id<"taskRuns">,
  updates: Partial<Doc<"taskRuns">>
): TaskRunWithChildren[] {
  return runs.map((run) => {
    if (run._id === runId) {
      return { ...run, ...updates };
    }
    if (run.children && run.children.length > 0) {
      return {
        ...run,
        children: updateRunInTree(run.children, runId, updates),
      };
    }
    return run;
  });
}
