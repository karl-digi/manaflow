import { waitForConnectedSocket } from "@/contexts/socket/socket-boot";
import type {
  GitSyncRunRequest,
  GitSyncRunResponse,
  GitSyncStatus,
  GitSyncStatusRequest,
  GitSyncStatusResponse,
} from "@cmux/shared";
import { queryOptions } from "@tanstack/react-query";

export function gitSyncStatusQueryOptions(taskRunId: string) {
  return queryOptions({
    queryKey: ["git-sync-status", taskRunId],
    queryFn: async () => {
      const socket = await waitForConnectedSocket();
      const payload: GitSyncStatusRequest = {
        taskRunId: taskRunId as GitSyncStatusRequest["taskRunId"],
      };
      return await new Promise<GitSyncStatus>((resolve, reject) => {
        socket.emit("git-sync-status", payload, (response: GitSyncStatusResponse) => {
          if (response.ok) {
            resolve(response.status);
            return;
          }
          reject(new Error(response.error || "Failed to load sync status"));
        });
      });
    },
    staleTime: 30_000,
  });
}

export async function runGitSync(
  request: GitSyncRunRequest,
): Promise<GitSyncRunResponse> {
  const socket = await waitForConnectedSocket();
  return await new Promise<GitSyncRunResponse>((resolve) => {
    socket.emit("git-sync-run", request, (response: GitSyncRunResponse) => {
      resolve(response);
    });
  });
}
