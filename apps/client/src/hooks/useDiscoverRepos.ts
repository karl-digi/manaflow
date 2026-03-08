import { useMutation } from "@tanstack/react-query";
import { useMutation as useConvexMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { WWW_ORIGIN } from "@/lib/wwwOrigin";
import { cachedGetUser } from "@/lib/cachedGetUser";
import { stackClientApp } from "@/lib/stack";

interface DiscoverReposArgs {
  sandboxId: string;
  taskRunId: Id<"taskRuns">;
  teamSlugOrId: string;
  workspacePath?: string;
}

interface DiscoverReposResult {
  repos: string[];
  paths: Array<{ path: string; repo: string | null }>;
}

/**
 * Hook to discover git repositories in a sandbox and update the task run.
 * This is useful for tasks with custom environments where the agent clones
 * repos manually and we need to detect them for the git diff view.
 */
export function useDiscoverRepos() {
  const updateDiscoveredRepos = useConvexMutation(api.taskRuns.updateDiscoveredRepos);

  return useMutation({
    mutationFn: async ({
      sandboxId,
      taskRunId,
      teamSlugOrId,
      workspacePath = "/root/workspace",
    }: DiscoverReposArgs): Promise<DiscoverReposResult> => {
      // Get auth headers
      const user = await cachedGetUser(stackClientApp);
      const authHeaders = user ? await user.getAuthHeaders() : undefined;
      const headers = new Headers(authHeaders);
      headers.set("Content-Type", "application/json");

      // Call the discover-repos endpoint
      const response = await fetch(
        `${WWW_ORIGIN}/api/sandboxes/${sandboxId}/discover-repos`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ workspacePath }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to discover repos: ${errorText}`);
      }

      const result = (await response.json()) as DiscoverReposResult;

      // Update the task run with discovered repos if any were found
      if (result.repos.length > 0) {
        await updateDiscoveredRepos({
          teamSlugOrId,
          runId: taskRunId,
          discoveredRepos: result.repos,
        });
      }

      return result;
    },
    onSuccess: (result) => {
      if (result.repos.length > 0) {
        toast.success(`Discovered ${result.repos.length} repo(s)`, {
          description: result.repos.join(", "),
        });
      } else {
        toast.info("No git repositories found in workspace");
      }
    },
    onError: (error) => {
      console.error("Failed to discover repos:", error);
      toast.error("Failed to discover repositories", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });
}
