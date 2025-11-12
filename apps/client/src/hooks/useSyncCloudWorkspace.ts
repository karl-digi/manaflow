import { useSocket } from "@/contexts/socket/use-socket";
import type { Id } from "@cmux/convex/dataModel";
import { useCallback } from "react";

export function useSyncCloudWorkspace(
  taskRunId: Id<"taskRuns"> | null | undefined,
  teamSlugOrId: string
) {
  const { socket } = useSocket();

  const sync = useCallback(async () => {
    if (!socket || !taskRunId) {
      throw new Error("Socket not available or task run not found");
    }

    return new Promise<void>((resolve, reject) => {
      socket.emit(
        "sync-cloud-workspace",
        { taskRunId, teamSlugOrId },
        (response: { success: boolean; error?: string }) => {
          if (response.success) {
            resolve();
          } else {
            reject(new Error(response.error || "Failed to sync workspace"));
          }
        }
      );
    });
  }, [socket, taskRunId, teamSlugOrId]);

  return { sync };
}
