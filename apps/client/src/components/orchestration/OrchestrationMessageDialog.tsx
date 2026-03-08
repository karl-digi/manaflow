import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Send, X } from "lucide-react";
import type { Id } from "@cmux/convex/dataModel";
import { postApiOrchestrateMessageMutation } from "@cmux/www-openapi-client/react-query";

interface OrchestrationMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamSlugOrId: string;
  taskRunId: Id<"taskRuns">;
  agentName: string;
}

const MESSAGE_TYPES = [
  { value: "request", label: "Request", description: "Ask the agent to do something" },
  { value: "status", label: "Status", description: "Share a status update" },
  { value: "handoff", label: "Handoff", description: "Transfer work to another agent" },
] as const;

export function OrchestrationMessageDialog({
  open,
  onOpenChange,
  teamSlugOrId,
  taskRunId,
  agentName,
}: OrchestrationMessageDialogProps) {
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"request" | "status" | "handoff">("request");

  const sendMessageMutation = useMutation({
    ...postApiOrchestrateMessageMutation(),
    onSuccess: () => {
      toast.success("Message sent to agent");
      setMessage("");
      setMessageType("request");
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(`Failed to send message: ${error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      toast.error("Please enter a message");
      return;
    }
    sendMessageMutation.mutate({
      body: {
        taskRunId: String(taskRunId),
        message,
        messageType,
        teamSlugOrId,
      },
    });
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
            Send Message to {agentName}
          </Dialog.Title>

          <Dialog.Description className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Send a message to the running agent via its mailbox.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {/* Message Type */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Message Type
              </label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {MESSAGE_TYPES.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setMessageType(type.value)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      messageType === type.value
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                        : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-700 dark:hover:border-neutral-600"
                    }`}
                  >
                    <div className="font-medium text-neutral-900 dark:text-neutral-100">
                      {type.label}
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-500">
                      {type.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Message */}
            <div>
              <label
                htmlFor="message"
                className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Message
              </label>
              <textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                className="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                placeholder="Enter your message..."
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
                disabled={sendMessageMutation.isPending || !message.trim()}
                className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {sendMessageMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 size-4" />
                    Send Message
                  </>
                )}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
