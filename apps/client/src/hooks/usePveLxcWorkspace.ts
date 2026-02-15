import { useMutation, useQuery } from "@tanstack/react-query";
import { useQuery as useConvexQuery } from "convex/react";
import {
  postApiPveLxcTaskRunsByTaskRunIdIsStopped,
  type Options,
  type PostApiPveLxcTaskRunsByTaskRunIdResumeData,
  type PostApiPveLxcTaskRunsByTaskRunIdResumeResponse,
} from "@cmux/www-openapi-client";
import { postApiPveLxcTaskRunsByTaskRunIdResumeMutation } from "@cmux/www-openapi-client/react-query";
import { toast } from "sonner";
import { queryClient } from "@/query-client";
import { api } from "@cmux/convex/api";
import { type Id } from "@cmux/convex/dataModel";

interface PveLxcWorkspaceQueryArgs {
  taskRunId: Id<"taskRuns">;
  teamSlugOrId: string;
  enabled?: boolean;
}

interface UseResumePveLxcWorkspaceArgs {
  taskRunId: Id<"taskRuns">;
  teamSlugOrId: string;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export function pveLxcStoppedQueryKey(taskRunId: string, teamSlugOrId: string) {
  return ["pve-lxc", "task-run", taskRunId, "stopped", teamSlugOrId] as const;
}

export function usePveLxcInstanceStoppedQuery({
  taskRunId,
  teamSlugOrId,
  enabled,
}: PveLxcWorkspaceQueryArgs) {
  const taskRun = useConvexQuery(api.taskRuns.get, {
    teamSlugOrId,
    id: taskRunId,
  });
  const canResume = taskRun?.vscode?.provider === "pve-lxc";
  return useQuery({
    enabled: canResume && enabled !== false,
    queryKey: pveLxcStoppedQueryKey(taskRunId, teamSlugOrId),
    queryFn: async ({ signal }) => {
      const { data } = await postApiPveLxcTaskRunsByTaskRunIdIsStopped({
        path: {
          taskRunId,
        },
        body: {
          teamSlugOrId,
        },
        signal,
        throwOnError: true,
      });
      return data;
    },
  });
}

export function useResumePveLxcWorkspace({
  taskRunId,
  teamSlugOrId,
  onSuccess,
  onError,
}: UseResumePveLxcWorkspaceArgs) {
  return useMutation<
    PostApiPveLxcTaskRunsByTaskRunIdResumeResponse,
    Error,
    Options<PostApiPveLxcTaskRunsByTaskRunIdResumeData>,
    { toastId: string | number }
  >({
    ...postApiPveLxcTaskRunsByTaskRunIdResumeMutation(),
    mutationKey: ["resume", "pve-lxc", "task-run", taskRunId],
    onMutate: async () => {
      const toastId = toast.loading("Resuming container...");
      return { toastId };
    },
    onSuccess: (_data, __, context) => {
      toast.success("Container resumed", { id: context?.toastId });
      queryClient.setQueryData(pveLxcStoppedQueryKey(taskRunId, teamSlugOrId), {
        stopped: false,
      });
      onSuccess?.();
    },
    onError: (error, _variables, context) => {
      const message =
        error instanceof Error ? error.message : "Failed to resume container.";
      toast.error(message, { id: context?.toastId });
      onError?.(error);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: pveLxcStoppedQueryKey(taskRunId, teamSlugOrId),
      });
    },
  });
}
