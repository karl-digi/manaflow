import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";

export const Route = createFileRoute("/_layout/$teamSlugOrId/acp/$threadId")({
  component: AcpThreadDetail,
});

function formatTimestamp(value: number | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function Pill({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

function MessageCard({
  role,
  kind,
  payload,
  sessionUpdateType,
  createdAt,
}: {
  role: string;
  kind: string;
  payload: unknown;
  sessionUpdateType?: string;
  createdAt?: number;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 text-neutral-900 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <Pill className="bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-50">
          {role}
        </Pill>
        <Pill className="bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
          {kind}
        </Pill>
        {sessionUpdateType ? (
          <Pill className="bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100">
            {sessionUpdateType}
          </Pill>
        ) : null}
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {formatTimestamp(createdAt)}
        </span>
      </div>
      <pre className="overflow-x-auto rounded bg-neutral-100 p-3 text-xs leading-relaxed text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}

function AcpThreadDetail() {
  const { teamSlugOrId, threadId } = Route.useParams();
  const threads = useQuery(api.acp.listThreads, {
    teamSlugOrId,
    limit: 200,
  });
  const messages = useQuery(api.acp.getThreadMessages, {
    teamSlugOrId,
    threadId: threadId as Id<"acpThreads">,
    limit: 500,
  });

  const thread = threads?.find((t) => t._id === threadId);

  return (
    <div className="flex h-full flex-col gap-4 bg-white p-6 text-neutral-900 dark:bg-black dark:text-neutral-50">
      <div className="flex items-center gap-3">
        <Link
          to="/$teamSlugOrId/acp"
          params={{ teamSlugOrId }}
          className="text-sm text-neutral-600 transition hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          ← Back to threads
        </Link>
        {thread ? (
          <Pill className="bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50">
            {thread.status}
          </Pill>
        ) : (
          <Pill className="bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50">
            Loading thread…
          </Pill>
        )}
      </div>

      {thread ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
          <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {thread.title || "Untitled ACP thread"}
          </div>
          <div className="text-sm text-neutral-600 dark:text-neutral-400">
            Provider: {thread.provider}
          </div>
          <div className="text-xs text-neutral-500 dark:text-neutral-500">
            Session: {thread.sessionId ?? "unknown"} · Updated{" "}
            {formatTimestamp(thread.updatedAt)}
          </div>
          {thread.errorMessage ? (
            <div className="mt-2 text-sm text-red-600 dark:text-red-400">
              {thread.errorMessage}
            </div>
          ) : null}
        </div>
      ) : null}

      {messages === undefined ? (
        <div className="text-neutral-600 dark:text-neutral-400">Loading…</div>
      ) : messages.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
          No messages yet.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {messages.map((msg) => (
            <MessageCard
              key={`${msg.sequence}-${msg.createdAt ?? msg._id}`}
              role={msg.role}
              kind={msg.kind}
              payload={msg.content}
              sessionUpdateType={msg.sessionUpdateType ?? undefined}
              createdAt={msg.createdAt}
            />
          ))}
        </div>
      )}
    </div>
  );
}
