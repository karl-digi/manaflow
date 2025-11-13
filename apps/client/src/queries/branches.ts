import { waitForConnectedSocket } from "@/contexts/socket/socket-boot";
import { queryOptions } from "@tanstack/react-query";
import type { GitHubBranchesResponse } from "@cmux/shared";
import { emitWithAuth } from "@/lib/socketAuth";

export function branchesQueryOptions({
  teamSlugOrId,
  repoFullName,
}: {
  teamSlugOrId: string;
  repoFullName: string;
}) {
  return queryOptions<GitHubBranchesResponse>({
    queryKey: ["branches", teamSlugOrId, repoFullName],
    queryFn: async () => {
      const socket = await waitForConnectedSocket();
      return await new Promise<GitHubBranchesResponse>((resolve, reject) => {
        emitWithAuth(
          socket,
          "github-fetch-branches",
          { teamSlugOrId, repo: repoFullName },
          (response: GitHubBranchesResponse) => {
            if (response.success) {
              resolve(response);
            } else {
              reject(new Error(response.error || "Failed to load branches"));
            }
          }
        ).then((success) => {
          if (!success) {
            reject(new Error("Failed to request branches"));
          }
        });
      });
    },
    staleTime: 10_000,
  });
}
