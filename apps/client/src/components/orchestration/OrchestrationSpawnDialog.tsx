import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@cmux/convex/api";
import { useConvex } from "convex/react";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";

interface OrchestrationSpawnDialogProps {
  teamSlugOrId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OrchestrationSpawnDialog({
  teamSlugOrId,
  open,
  onOpenChange,
}: OrchestrationSpawnDialogProps) {
  const convex = useConvex();
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState("");
  const [priority, setPriority] = useState(5);
  const [selectedModel, setSelectedModel] = useState("");

  // Fetch available models
  const { data: models } = useQuery(
    convexQuery(api.models.listAvailable, { teamSlugOrId })
  );

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      const taskId = await convex.mutation(api.orchestrationQueries.createTask, {
        teamSlugOrId,
        prompt,
        priority,
        metadata: selectedModel ? { agentName: selectedModel } : undefined,
      });
      return taskId;
    },
    onSuccess: () => {
      toast.success("Task created successfully");
      setPrompt("");
      setPriority(5);
      setSelectedModel("");
      onOpenChange(false);
      void queryClient.invalidateQueries();
    },
    onError: (error) => {
      toast.error(`Failed to create task: ${error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }
    createTaskMutation.mutate();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-global-blocking)] bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[var(--z-global-blocking)] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-200 bg-white p-6 shadow-xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          {/* Close button */}
          <Dialog.Close asChild>
            <button
              type="button"
              className="absolute right-4 top-4 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:hover:bg-neutral-800 dark:hover:text-white"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </Dialog.Close>

          <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-white">
            Spawn Agent Task
          </Dialog.Title>

          <Dialog.Description className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Create a new orchestration task. The background worker will assign it to an available agent.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {/* Prompt */}
            <div>
              <label
                htmlFor="prompt"
                className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Task Prompt
              </label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                placeholder="Describe what the agent should do..."
              />
            </div>

            {/* Model selector */}
            <div>
              <label
                htmlFor="model"
                className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Agent Model (Optional)
              </label>
              <select
                id="model"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              >
                <option value="">Auto-select</option>
                {models?.map((model) => (
                  <option key={model._id} value={model._id}>
                    {model.displayName ?? model._id}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-neutral-500">
                Leave empty to let the worker select the best available agent
              </p>
            </div>

            {/* Priority */}
            <div>
              <label
                htmlFor="priority"
                className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Priority (1 = highest, 10 = lowest)
              </label>
              <input
                type="number"
                id="priority"
                min={1}
                max={10}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="mt-1 block w-24 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={createTaskMutation.isPending || !prompt.trim()}
                className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {createTaskMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Task"
                )}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
