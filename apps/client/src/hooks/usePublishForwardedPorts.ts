import { useMutation } from "@tanstack/react-query";
import {
  postApiSandboxesByIdPublishDevcontainer,
  type PostApiSandboxesByIdPublishDevcontainerResponse,
} from "@cmux/www-openapi-client";
import { type Id } from "@cmux/convex/dataModel";
import { toast } from "sonner";

interface UsePublishForwardedPortsArgs {
  taskRunId: Id<"taskRuns">;
  sandboxId?: string | null;
  teamSlugOrId: string;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

export function usePublishForwardedPorts({
  taskRunId,
  sandboxId,
  teamSlugOrId,
  onSuccess,
  onError,
}: UsePublishForwardedPortsArgs) {
  return useMutation<
    PostApiSandboxesByIdPublishDevcontainerResponse,
    Error,
    void,
    { toastId: string | number }
  >({
    mutationKey: ["publish-forwarded-ports", "task-run", taskRunId, sandboxId],
    mutationFn: async () => {
      if (!sandboxId) {
        throw new Error("Sandbox ID is required to refresh forwarded ports");
      }

      const { data } = await postApiSandboxesByIdPublishDevcontainer({
        path: { id: sandboxId },
        body: { teamSlugOrId, taskRunId },
        throwOnError: true,
      });
      return data;
    },
    onMutate: async () => {
      const toastId = toast.loading("Refreshing forwarded ports...");
      return { toastId };
    },
    onSuccess: (_data, __, context) => {
      toast.success("Forwarded ports refreshed", { id: context?.toastId });
      onSuccess?.();
    },
    onError: (error, _variables, context) => {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to refresh forwarded ports.";
      toast.error(message, { id: context?.toastId });
      onError?.(error);
    },
  });
}
