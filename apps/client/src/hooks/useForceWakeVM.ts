import { useUser } from "@stackframe/stack";
import type { Id } from "@cmux/convex/dataModel";
import { useCallback, useState } from "react";
import { toast } from "sonner";

interface ForceWakeVMOptions {
  runId: Id<"taskRuns">;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

interface ForceWakeVMState {
  isWaking: boolean;
  error: string | null;
}

export function useForceWakeVM() {
  const user = useUser();
  const [state, setState] = useState<ForceWakeVMState>({
    isWaking: false,
    error: null,
  });

  const forceWakeVM = useCallback(
    async ({ runId, onSuccess, onError }: ForceWakeVMOptions) => {
      if (!user) {
        const errorMsg = "You must be logged in to wake a VM";
        toast.error(errorMsg);
        onError?.(errorMsg);
        return;
      }

      setState({ isWaking: true, error: null });

      const toastId = toast.loading("Waking VM...", {
        description: "Please wait while we resume the virtual machine",
      });

      try {
        const accessToken = await user.getAuthJson().then((auth) => auth.accessToken);

        if (!accessToken) {
          throw new Error("No access token available");
        }

        const response = await fetch("/api/taskrun/force-wake", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-stack-auth": accessToken,
          },
          body: JSON.stringify({ runId }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error || `HTTP error ${response.status}`
          );
        }

        if (!response.body) {
          throw new Error("No response body");
        }

        // Process SSE events
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let lastEvent = "";
        let result: "resumed" | "already_ready" | "failed" | "not_found" | null = null;

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              lastEvent = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              const data = JSON.parse(line.slice(5).trim());

              // Update toast based on event
              if (lastEvent === "resuming") {
                toast.loading("Resuming VM...", {
                  id: toastId,
                  description: `Current status: ${data.status}`,
                });
              } else if (lastEvent === "resume_retry") {
                toast.loading(`Retrying resume (attempt ${data.attempt})...`, {
                  id: toastId,
                  description: data.error || "Retrying...",
                });
              } else if (lastEvent === "resumed") {
                toast.loading("VM resumed, waiting for ready state...", {
                  id: toastId,
                  description: "Almost there...",
                });
                result = "resumed";
              } else if (lastEvent === "already_ready") {
                result = "already_ready";
              } else if (lastEvent === "resume_failed") {
                result = "failed";
              } else if (lastEvent === "instance_not_found") {
                result = "not_found";
              } else if (lastEvent === "complete") {
                result = data.result;
              } else if (lastEvent === "error") {
                throw new Error(data.error || "Unknown error");
              }
            }
          }
        }

        // Handle final result
        if (result === "resumed" || result === "already_ready") {
          toast.success("VM is ready!", {
            id: toastId,
            description: result === "already_ready"
              ? "The VM was already running"
              : "VM has been successfully resumed",
          });
          setState({ isWaking: false, error: null });
          onSuccess?.();
        } else if (result === "not_found") {
          throw new Error("VM instance not found");
        } else if (result === "failed") {
          throw new Error("Failed to resume VM after multiple attempts");
        } else {
          throw new Error("Unknown result from wake operation");
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Failed to wake VM";
        console.error("[useForceWakeVM] Error:", error);

        toast.error("Failed to wake VM", {
          id: toastId,
          description: errorMsg,
        });

        setState({ isWaking: false, error: errorMsg });
        onError?.(errorMsg);
      }
    },
    [user]
  );

  return {
    forceWakeVM,
    isWaking: state.isWaking,
    error: state.error,
  };
}
