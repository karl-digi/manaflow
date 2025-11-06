import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";

type ArchiveRunOptions = {
  label?: string;
};

export function useArchiveTaskRun(teamSlugOrId: string) {
  const archiveMutation = useMutation(api.taskRuns.archive);
  const unarchiveMutation = useMutation(api.taskRuns.unarchive);

  const archiveRun = useCallback(
    async (runId: Id<"taskRuns">, options?: ArchiveRunOptions) => {
      try {
        await archiveMutation({ teamSlugOrId, id: runId });
        toast("Task run archived", {
          description: options?.label,
          action: {
            label: "Undo",
            onClick: () => {
              void unarchiveMutation({ teamSlugOrId, id: runId });
            },
          },
        });
      } catch (error) {
        console.error("Failed to archive task run", error);
        toast.error("Failed to archive task run");
        throw error;
      }
    },
    [archiveMutation, teamSlugOrId, unarchiveMutation]
  );

  const unarchiveRun = useCallback(
    async (runId: Id<"taskRuns">, options?: ArchiveRunOptions) => {
      try {
        await unarchiveMutation({ teamSlugOrId, id: runId });
        toast("Task run unarchived", {
          description: options?.label,
        });
      } catch (error) {
        console.error("Failed to unarchive task run", error);
        toast.error("Failed to unarchive task run");
        throw error;
      }
    },
    [teamSlugOrId, unarchiveMutation]
  );

  return {
    archiveRun,
    unarchiveRun,
  };
}
