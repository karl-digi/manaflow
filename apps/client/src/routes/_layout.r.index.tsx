import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MessageSquarePlus, Sparkles } from "lucide-react";
import { useState, useCallback } from "react";
import { rivetClient, getVisitorId } from "@/rivet/client";

export const Route = createFileRoute("/_layout/r/")({
  component: RivetChatIndex,
});

function RivetChatIndex() {
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const visitorId = getVisitorId();

  const handleNewChat = useCallback(async () => {
    setIsCreating(true);
    try {
      const chatId = crypto.randomUUID();
      // Create the chat actor
      rivetClient.aiChat.getOrCreate([visitorId, chatId], {
        params: { visitorId },
      });
      // Add to list
      const chatListActor = rivetClient.chatList.getOrCreate([visitorId], {
        params: { visitorId },
      });
      await chatListActor.addChat(chatId);
      // Navigate to new chat
      await navigate({ to: "/r/$chatId", params: { chatId } });
    } catch (error) {
      console.error("Failed to create chat:", error);
    } finally {
      setIsCreating(false);
    }
  }, [visitorId, navigate]);

  return (
    <div className="flex h-full flex-col items-center justify-center bg-white px-6 dark:bg-[#191919]">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-100 dark:bg-violet-900/30">
          <Sparkles className="h-8 w-8 text-violet-500" />
        </div>
        <h1 className="mb-3 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Rivet Chat Demo
        </h1>
        <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
          A realtime AI chat powered by Rivet Actors. Messages are persisted,
          updates are instant, and the whole thing scales horizontally.
        </p>
        <button
          type="button"
          onClick={handleNewChat}
          disabled={isCreating}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-600 disabled:opacity-50"
        >
          <MessageSquarePlus className="h-4 w-4" />
          {isCreating ? "Creating..." : "Start a new chat"}
        </button>

        <div className="mt-12 rounded-lg border border-neutral-200/70 bg-neutral-50 p-4 text-left dark:border-neutral-800/70 dark:bg-neutral-900">
          <h2 className="mb-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
            How it works
          </h2>
          <ul className="space-y-2 text-[13px] text-neutral-600 dark:text-neutral-400">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500" />
              Each chat is a Rivet Actor with persistent state
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500" />
              Messages survive restarts and deployments
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500" />
              Realtime updates via WebSocket broadcasts
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500" />
              Scales to millions of concurrent actors
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
