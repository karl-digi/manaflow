import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/t/$teamSlugOrId/")({
  component: ConversationsEmptyState,
});

function ConversationsEmptyState() {
  return (
    <div className="flex h-full min-h-dvh items-center justify-center px-6">
      <div className="max-w-md rounded-3xl border border-neutral-200/70 bg-white/80 p-6 text-center dark:border-neutral-800/70 dark:bg-neutral-900/70">
        <div className="text-xs text-neutral-400 dark:text-neutral-500">
          cmux conversations
        </div>
        <h1 className="mt-3 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          Pick a conversation to get started.
        </h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Conversations live in the sidebar. Start a new thread or select an
          existing one to see messages here.
        </p>
      </div>
    </div>
  );
}
