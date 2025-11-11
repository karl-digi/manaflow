import { waitForConnectedSocket } from "@/contexts/socket/socket-boot";
import type { LocalRepoBranchesResponse } from "@cmux/shared";
import { queryOptions } from "@tanstack/react-query";

export function localBranchesQueryOptions(path: string) {
  return queryOptions<LocalRepoBranchesResponse>({
    queryKey: ["local-branches", path],
    queryFn: async () => {
      if (!path) {
        throw new Error("Missing repository path");
      }
      const socket = await waitForConnectedSocket();
      return await new Promise<LocalRepoBranchesResponse>((resolve, reject) => {
        socket.emit(
          "local-repo-branches",
          { path },
          (response: LocalRepoBranchesResponse) => {
            if (response.success) {
              resolve(response);
            } else {
              reject(
                new Error(response.error || "Failed to load local branches")
              );
            }
          }
        );
      });
    },
    staleTime: 5_000,
  });
}
