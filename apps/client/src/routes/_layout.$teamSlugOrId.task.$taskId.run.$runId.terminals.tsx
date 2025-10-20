import { Button } from "@/components/ui/button";
import {
  DEFAULT_XTERM_BASE_URL,
  RemoteXterm,
  type RemoteXtermConnectionStatus,
} from "@/components/xterm/remote-xterm";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { Loader2, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import z from "zod";

const TABS_QUERY_KEY = ["xterm", "tabs"] as const;

async function fetchTerminalIds(baseUrl: string): Promise<string[]> {
  const response = await fetch(new URL("/api/tabs", baseUrl));
  if (!response.ok) {
    throw new Error(`Failed to load terminals (${response.status})`);
  }
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("Invalid terminal response");
  }
  const invalidEntry = payload.find((value) => typeof value !== "string");
  if (invalidEntry !== undefined) {
    throw new Error("Terminal response contained unexpected values");
  }
  return payload as string[];
}

interface CreateTerminalResponse {
  id: string;
}

async function createTerminal(baseUrl: string): Promise<CreateTerminalResponse> {
  const response = await fetch(new URL("/api/tabs", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cols: 80, rows: 24 }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create terminal (${response.status})`);
  }

  const payload = (await response.json()) as unknown;
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof (payload as { id?: unknown }).id !== "string"
  ) {
    throw new Error("Unexpected response when creating terminal");
  }

  return payload as CreateTerminalResponse;
}

async function deleteTerminal(baseUrl: string, tabId: string): Promise<void> {
  const response = await fetch(new URL(`/api/tabs/${tabId}`, baseUrl), {
    method: "DELETE",
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete terminal (${response.status})`);
  }
}

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
});

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/terminals"
)({
  params: {
    parse: paramsSchema.parse,
    stringify: (params) => ({
      taskId: params.taskId,
      runId: params.runId,
    }),
  },
  component: TaskRunTerminalsRoute,
});

function TaskRunTerminalsRoute() {
  const baseUrlRef = useRef<string>(DEFAULT_XTERM_BASE_URL);
  const queryClient = useQueryClient();

  const {
    data: fetchedTerminalIds,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: TABS_QUERY_KEY,
    queryFn: () => fetchTerminalIds(baseUrlRef.current),
    refetchInterval: 1000 * 10,
    refetchOnWindowFocus: "always",
  });

  const terminalIds = fetchedTerminalIds ?? [];
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [connectionStatuses, setConnectionStatuses] = useState<
    Record<string, RemoteXtermConnectionStatus>
  >({});

  useEffect(() => {
    setConnectionStatuses((prev) => {
      if (!terminalIds || terminalIds.length === 0) {
        return {};
      }
      const map = { ...prev };
      let changed = false;
      for (const key of Object.keys(map)) {
        if (!terminalIds.includes(key)) {
          delete map[key];
          changed = true;
        }
      }
      return changed ? map : prev;
    });
  }, [terminalIds]);

  useEffect(() => {
    if (!terminalIds || terminalIds.length === 0) {
      setActiveTerminalId((current) => (current === null ? current : null));
      return;
    }
    setActiveTerminalId((current) => {
      if (current && terminalIds.includes(current)) {
        return current;
      }
      return terminalIds[0];
    });
  }, [terminalIds]);

  const createMutation = useMutation({
    mutationFn: () => createTerminal(baseUrlRef.current),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: TABS_QUERY_KEY });
      setActiveTerminalId(result.id);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (terminalId: string) =>
      deleteTerminal(baseUrlRef.current, terminalId),
    onSuccess: (_, terminalId) => {
      queryClient.invalidateQueries({ queryKey: TABS_QUERY_KEY });
      setConnectionStatuses((prev) => {
        if (!(terminalId in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[terminalId];
        return next;
      });
      setActiveTerminalId((current) =>
        current === terminalId ? null : current
      );
    },
  });

  const handleStatusChange = useCallback(
    (terminalId: string, status: RemoteXtermConnectionStatus) => {
      setConnectionStatuses((prev) => {
        const existing = prev[terminalId];
        if (existing === status) {
          return prev;
        }
        return { ...prev, [terminalId]: status };
      });
    },
    []
  );

  const spacingClass = "px-3 py-2";
  const closingTerminalId = deleteMutation.variables ?? null;

  return (
    <div className="flex h-full flex-col bg-neutral-50 dark:bg-black">
      <div
        className={clsx(
          "flex items-center justify-between border-b border-neutral-200 bg-neutral-50/60 text-neutral-700",
          "dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-300",
          spacingClass
        )}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Terminals</h2>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {terminalIds.length} {terminalIds.length === 1 ? "tab" : "tabs"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <Loader2
              className={clsx("h-4 w-4", { "animate-spin": isLoading })}
            />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            New Terminal
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading terminals…
        </div>
      ) : isError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-neutral-500 dark:text-neutral-400">
          <span>Failed to load terminals.</span>
          {error instanceof Error ? (
            <span className="max-w-sm text-xs text-neutral-400 dark:text-neutral-500">
              {error.message}
            </span>
          ) : null}
          <Button size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : terminalIds.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm text-neutral-500 dark:text-neutral-400">
          <p>No terminals yet.</p>
          <Button
            size="sm"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create terminal
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div
            className={clsx(
              "flex items-center gap-1 overflow-x-auto border-b border-neutral-200 bg-neutral-100/70",
              "dark:border-neutral-800 dark:bg-neutral-900/40",
              spacingClass
            )}
          >
            {terminalIds.map((terminalId) => {
              const isActive = terminalId === activeTerminalId;
              const status = connectionStatuses[terminalId];
              const isClosing =
                deleteMutation.isPending && closingTerminalId === terminalId;
              return (
                <div
                  key={terminalId}
                  className={clsx(
                    "group flex items-center rounded-md border px-2 py-1 text-xs shadow-sm transition-colors",
                    isActive
                      ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-200"
                      : "border-transparent bg-neutral-200/60 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-200 dark:bg-neutral-800/70 dark:text-neutral-300 dark:hover:bg-neutral-700/70"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveTerminalId(terminalId)}
                    className="flex items-center gap-2"
                  >
                    <span className="font-medium">{terminalId.slice(0, 8)}</span>
                    {status && status !== "connected" ? (
                      <span className="rounded bg-neutral-900/60 px-1 py-px text-[10px] uppercase tracking-wide text-neutral-100 dark:bg-neutral-700/70">
                        {status}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className={clsx(
                      "ml-2 rounded p-1 text-neutral-500 transition hover:bg-neutral-300/80 hover:text-neutral-700",
                      "dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                    )}
                    onClick={() => deleteMutation.mutate(terminalId)}
                    aria-label="Close terminal"
                    disabled={isClosing}
                  >
                    {isClosing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex flex-1 flex-col overflow-hidden">
            {terminalIds.map((terminalId) => (
              <div
                key={terminalId}
                className={clsx("flex flex-1", {
                  hidden: terminalId !== activeTerminalId,
                })}
              >
                <RemoteXterm
                  terminalId={terminalId}
                  isActive={terminalId === activeTerminalId}
                  baseUrl={baseUrlRef.current}
                  onStatusChange={(status) =>
                    handleStatusChange(terminalId, status)
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
