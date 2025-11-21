import { Link, useNavigate } from "@tanstack/react-router";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@cmux/convex/api";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { postApiAcpNew } from "@cmux/www-openapi-client";
import { postApiAcpStart } from "@cmux/www-openapi-client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_layout/$teamSlugOrId/acp")({
  component: AcpThreadsPage,
});

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

const statusColor: Record<string, string> = {
  pending: "bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50",
  running: "bg-blue-200 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
  completed:
    "bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  error: "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-100",
};

function StatusBadge({ status }: { status: string }) {
  const cls = statusColor[status] ?? "bg-neutral-200 text-neutral-900";
  return <Pill className={cls}>{status}</Pill>;
}

function AcpThreadsPage() {
  const { teamSlugOrId } = Route.useParams();
  const navigate = useNavigate();
  const [workerUrl, setWorkerUrl] = useState<string>(() => {
    const stored = localStorage.getItem("acpWorkerUrl");
    return stored || "http://localhost:39377";
  });
  const [prompt, setPrompt] = useState<string>("");
  useEffect(() => {
    localStorage.setItem("acpWorkerUrl", workerUrl);
  }, [workerUrl]);

  const threads = useQuery(api.acp.listThreads, {
    teamSlugOrId,
    limit: 100,
  });
  const createThreadMutation = useMutation({
    mutationFn: async () => {
      const response = await postApiAcpNew({
        body: {
          teamSlugOrId,
          provider: "opencode",
          title: "New OpenCode ACP thread",
        },
      });
      return response?.data?.threadId;
    },
  });
  const startThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      await postApiAcpStart({
        body: {
          teamSlugOrId,
          threadId,
          workerUrl: workerUrl.trim(),
          prompt: prompt.trim() || undefined,
        },
      });
    },
  });

  const isMutating = useMemo(
    () => createThreadMutation.isPending || startThreadMutation.isPending,
    [createThreadMutation.isPending, startThreadMutation.isPending]
  );

  return (
    <div className="flex h-full flex-col gap-4 bg-white p-6 text-neutral-900 dark:bg-black dark:text-neutral-50">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">ACP Threads</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Live threads captured from ACP sessions. Select a thread to inspect
            full messages and tool calls.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="w-64 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 shadow-inner focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
            value={workerUrl}
            onChange={(e) => setWorkerUrl(e.target.value)}
            placeholder="Worker URL"
          />
          <input
            className="w-72 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 shadow-inner focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Optional initial prompt"
          />
          <Button
            variant="default"
            disabled={isMutating}
            onClick={async () => {
              try {
                const newId = await createThreadMutation.mutateAsync();
                if (!newId) return;
                await startThreadMutation.mutateAsync(newId);
                navigate({
                  to: "/$teamSlugOrId/acp/$threadId",
                  params: { teamSlugOrId, threadId: newId },
                });
              } catch (error) {
                console.error("Failed to create ACP thread", error);
              }
            }}
          >
            {isMutating ? "Starting…" : "New ACP thread"}
          </Button>
        </div>
      </div>

      {threads === undefined ? (
        <div className="text-neutral-600 dark:text-neutral-400">Loading…</div>
      ) : threads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
          No ACP threads yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {threads.map((thread) => (
            <Link
              key={thread._id}
              to="/$teamSlugOrId/acp/$threadId"
              params={{ teamSlugOrId, threadId: thread._id }}
              className="group relative flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-left shadow-sm transition hover:border-neutral-400 hover:bg-white dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                  {thread.title || "Untitled ACP thread"}
                </div>
                <StatusBadge status={thread.status} />
              </div>
              <div className="text-xs text-neutral-600 dark:text-neutral-400">
                Provider: {thread.provider}
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-500">
                Updated {new Date(thread.updatedAt).toLocaleString()}
              </div>
              {thread.errorMessage ? (
                <div className="text-xs text-red-600 dark:text-red-400">
                  {thread.errorMessage}
                </div>
              ) : null}
              <div className="pointer-events-none absolute inset-0 rounded-lg ring-0 transition group-hover:ring-1 group-hover:ring-neutral-400 dark:group-hover:ring-neutral-500" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
