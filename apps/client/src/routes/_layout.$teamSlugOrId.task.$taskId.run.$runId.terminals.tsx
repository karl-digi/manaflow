import { FloatingPane } from "@/components/floating-pane";
import { Button } from "@/components/ui/button";
import { createTerminalOptions } from "@cmux/shared/terminal-config";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { convexQuery } from "@convex-dev/react-query";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
  type QueryKey,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { toast } from "sonner";
import { Plus, Terminal as TerminalIcon, X } from "lucide-react";
import z from "zod";
import { Terminal as XTermTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { AttachAddon } from "@xterm/addon-attach";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
});

const TERMINAL_BACKEND_PORT = "39383";

function computeBackendOrigin(): string {
  if (typeof window === "undefined") {
    return `http://127.0.0.1:${TERMINAL_BACKEND_PORT}`;
  }
  const current = new URL(window.location.href);
  current.port = TERMINAL_BACKEND_PORT;
  current.pathname = "";
  current.search = "";
  current.hash = "";
  return current.origin;
}

function terminalTabsQueryKey(backendOrigin: string): QueryKey {
  return ["taskRun", "terminals", backendOrigin];
}

function buildBackendUrl(backendOrigin: string, path: string): string {
  return new URL(path, backendOrigin).toString();
}

async function fetchTerminalIds(backendOrigin: string): Promise<string[]> {
  const response = await fetch(buildBackendUrl(backendOrigin, "/api/tabs"), {
    headers: {
      "Accept": "application/json",
    },
    method: "GET",
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(`Failed to load terminals (${response.status})`);
  }

  const payload = (await response.json()) as Array<string>;
  return payload.map((id) => String(id));
}

function terminalTabsQueryOptions(backendOrigin: string) {
  return {
    queryKey: terminalTabsQueryKey(backendOrigin),
    queryFn: () => fetchTerminalIds(backendOrigin),
    staleTime: 10_000,
  } as const;
}

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/terminals"
)({
  component: TaskRunTerminalsPage,
  params: {
    parse: paramsSchema.parse,
    stringify: (params) => ({
      taskId: params.taskId,
      runId: params.runId,
    }),
  },
  loader: async (opts) => {
    await opts.context.queryClient.ensureQueryData(
      convexQuery(api.taskRuns.get, {
        teamSlugOrId: opts.params.teamSlugOrId,
        id: opts.params.runId,
      })
    );

    if (typeof window !== "undefined") {
      const backendOrigin = computeBackendOrigin();
      await opts.context.queryClient.ensureQueryData(
        terminalTabsQueryOptions(backendOrigin)
      );
    }
  },
});

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

function TaskRunTerminalsPage() {
  const backendOrigin = useMemo(() => computeBackendOrigin(), []);
  const queryClient = useQueryClient();

  const { data: terminalIds } = useSuspenseQuery(
    terminalTabsQueryOptions(backendOrigin)
  );

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

  useEffect(() => {
    if (terminalIds.length === 0) {
      setActiveTab(null);
      return;
    }

    setActiveTab((current) => {
      if (current && terminalIds.includes(current)) {
        return current;
      }
      return terminalIds[0] ?? null;
    });
  }, [terminalIds]);

  const createTerminal = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        buildBackendUrl(backendOrigin, "/api/tabs"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cols: 80, rows: 24 }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to create terminal (${response.status})`);
      }

      const payload = (await response.json()) as { id: string };
      return payload.id;
    },
    onSuccess: (newId) => {
      setActiveTab(newId ?? null);
      void queryClient.invalidateQueries({
        queryKey: terminalTabsQueryKey(backendOrigin),
      });
    },
    onError: (error: unknown) => {
      const description =
        error instanceof Error ? error.message : "Unknown error creating terminal";
      toast.error("Unable to create terminal", { description });
    },
  });

  const deleteTerminal = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(
        buildBackendUrl(backendOrigin, `/api/tabs/${id}`),
        {
          method: "DELETE",
        }
      );

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to close terminal (${response.status})`);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: terminalTabsQueryKey(backendOrigin),
      });
    },
    onError: (error: unknown) => {
      const description =
        error instanceof Error ? error.message : "Unknown error closing terminal";
      toast.error("Unable to close terminal", { description });
    },
    onSettled: () => {
      setClosingId(null);
    },
  });

  const annotatedTerminals = useMemo(
    () =>
      terminalIds.map((id, index) => ({
        id,
        index,
        label: `Terminal ${index + 1}`,
        shortId: id.replace(/-.*/, "").slice(0, 8),
      })),
    [terminalIds]
  );

  const handleCreate = useCallback(() => {
    createTerminal.mutate();
  }, [createTerminal]);

  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, id: string) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setActiveTab(id);
      }
    },
    []
  );

  const handleClose = useCallback(
    (id: string) => {
      setClosingId(id);
      setActiveTab((current) => {
        if (current !== id) return current;
        const ids = terminalIds;
        if (ids.length <= 1) return null;
        const index = ids.indexOf(id);
        if (index === -1) {
          return ids[0] ?? null;
        }
        if (index > 0) {
          return ids[index - 1] ?? null;
        }
        return ids[index + 1] ?? null;
      });
      deleteTerminal.mutate(id);
    },
    [deleteTerminal, terminalIds]
  );

  return (
    <FloatingPane
      header={
        <div className="flex items-center justify-between border-b border-neutral-200/80 bg-white px-4 py-3 dark:border-neutral-800/70 dark:bg-neutral-900">
          <div className="flex items-center gap-2 text-neutral-800 dark:text-neutral-200">
            <TerminalIcon className="h-4 w-4" aria-hidden />
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Terminals</span>
              <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                Connected to backend on port {TERMINAL_BACKEND_PORT}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleCreate}
              disabled={createTerminal.isPending}
            >
              <Plus className="mr-1.5 h-3 w-3" aria-hidden />
              New terminal
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex h-full flex-col">
        {annotatedTerminals.length > 0 ? (
          <div className="flex flex-col h-full">
            <div className="flex w-full flex-row gap-2 overflow-x-auto border-b border-neutral-200/80 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800/70 dark:bg-neutral-950/40">
              {annotatedTerminals.map(({ id, label, shortId }) => {
                const isActive = id === activeTab;
                const isClosing = closingId === id;
                return (
                  <div
                    key={id}
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={0}
                    onClick={() => setActiveTab(id)}
                    onKeyDown={(event) => handleTabKeyDown(event, id)}
                    className={clsx(
                      "group inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors",
                      isActive
                        ? "border-blue-500/80 bg-blue-50 text-blue-700 dark:border-blue-400/70 dark:bg-blue-500/20 dark:text-blue-100"
                        : "border-transparent bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-800"
                    )}
                  >
                    <TerminalIcon className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="truncate">
                      {label}
                      <span className="ml-1 text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                        {shortId}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Close ${label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleClose(id);
                      }}
                      disabled={isClosing}
                      className={clsx(
                        "ml-1 flex h-5 w-5 items-center justify-center rounded",
                        "text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-600",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                        "dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                      )}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="relative flex-1 bg-neutral-950/95 dark:bg-neutral-950">
              {annotatedTerminals.map(({ id, label }) => (
                <TerminalSession
                  key={id}
                  terminalId={id}
                  backendOrigin={backendOrigin}
                  isActive={id === activeTab}
                  isClosing={closingId === id}
                  label={label}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <div className="text-center text-sm text-neutral-500 dark:text-neutral-400">
              <p className="font-medium">No terminals yet</p>
              <p className="text-xs">
                Spawn a terminal to connect to the task workspace shell.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={handleCreate}
              disabled={createTerminal.isPending}
            >
              <Plus className="mr-1.5 h-3 w-3" aria-hidden />
              Create terminal
            </Button>
          </div>
        )}
      </div>
    </FloatingPane>
  );
}

interface TerminalSessionProps {
  terminalId: string;
  backendOrigin: string;
  isActive: boolean;
  isClosing: boolean;
  label: string;
}

interface TerminalResources {
  term: XTermTerminal;
  fitAddon: FitAddon;
  attachAddon: AttachAddon | null;
  socket: WebSocket | null;
  resizeObserver: ResizeObserver | null;
  webglAddon: WebglAddon | null;
}

type TerminalDimensions = { cols: number; rows: number };

function normalizeDimensions(cols: number, rows: number): TerminalDimensions {
  const safeCols = Number.isFinite(cols) && cols > 0 ? cols : 80;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 24;
  return {
    cols: Math.max(20, Math.min(320, Math.round(safeCols))),
    rows: Math.max(8, Math.min(120, Math.round(safeRows))),
  };
}

function TerminalSession({
  terminalId,
  backendOrigin,
  isActive,
  isClosing,
  label,
}: TerminalSessionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const resourcesRef = useRef<TerminalResources | null>(null);
  const reconnectRef = useRef<() => void>(() => {});
  const closingRef = useRef(false);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);

  const fitAndMaybeResize = useCallback(() => {
    const resources = resourcesRef.current;
    if (!resources) return;

    resources.fitAddon.fit();
    const dims = normalizeDimensions(resources.term.cols, resources.term.rows);
    const { socket } = resources;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(
          JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows })
        );
      } catch (error) {
        console.error("Failed to send resize", error);
      }
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const surface = surfaceRef.current;
    if (!container || !surface) {
      return;
    }

    let disposed = false;
    const term = new XTermTerminal(
      createTerminalOptions({
        allowProposedApi: true,
        cursorBlink: true,
        scrollback: 8000,
        fontSize: 14,
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        theme: {
          background: "#0f172a",
          foreground: "#e2e8f0",
          cursor: "#38bdf8",
          selectionForeground: "#0f172a",
          selectionBackground: "rgba(56, 189, 248, 0.4)",
        },
      })
    );
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();
    const unicodeAddon = new Unicode11Addon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(unicodeAddon);
    unicodeAddon.activate(term);

    term.open(surface);

    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      term.loadAddon(webglAddon);
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose();
        webglAddon = null;
      });
    } catch (error) {
      console.warn("WebGL not available for terminal", error);
    }

    const resources: TerminalResources = {
      term,
      fitAddon,
      attachAddon: null,
      socket: null,
      resizeObserver: null,
      webglAddon,
    };

    resourcesRef.current = resources;
    setStatus("connecting");
    setStatusDetail(null);

    const resizeObserver = new ResizeObserver(() => {
      fitAndMaybeResize();
    });
    resizeObserver.observe(container);
    resources.resizeObserver = resizeObserver;

    const handleWindowResize = () => {
      window.requestAnimationFrame(() => fitAndMaybeResize());
    };

    window.addEventListener("resize", handleWindowResize);

    const connectSocket = () => {
      const currentResources = resourcesRef.current;
      if (!currentResources) return;

      if (currentResources.socket) {
        try {
          closingRef.current = true;
          currentResources.socket.close();
        } catch {
          // ignore
        }
      }

      currentResources.attachAddon?.dispose();
      currentResources.attachAddon = null;

      setStatus("connecting");
      setStatusDetail(null);

      const wsUrl = new URL(`/ws/${terminalId}`, backendOrigin);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(wsUrl);
      socket.binaryType = "arraybuffer";

      currentResources.socket = socket;

      const attachAddon = new AttachAddon(socket, { bidirectional: true });
      currentResources.attachAddon = attachAddon;
      currentResources.term.loadAddon(attachAddon);

      socket.addEventListener("open", () => {
        if (disposed) return;
        closingRef.current = false;
        setStatus("connected");
        setStatusDetail(null);
        fitAndMaybeResize();
        window.setTimeout(() => {
          if (!disposed) {
            fitAndMaybeResize();
          }
        }, 100);
      });

      socket.addEventListener("close", () => {
        currentResources.attachAddon?.dispose();
        currentResources.attachAddon = null;
        currentResources.socket = null;

        if (disposed) return;

        if (closingRef.current) {
          closingRef.current = false;
          return;
        }

        setStatus("disconnected");
        setStatusDetail(null);
      });

      socket.addEventListener("error", (event) => {
        if (disposed) return;
        console.error("Terminal websocket error", event);
        setStatus("error");
        setStatusDetail("Connection error");
      });
    };

    reconnectRef.current = () => {
      const currentResources = resourcesRef.current;
      if (!currentResources) return;
      const currentSocket = currentResources.socket;
      if (currentSocket) {
        const state = currentSocket.readyState;
        if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
          return;
        }
      }
      connectSocket();
    };

    connectSocket();
    fitAndMaybeResize();

    return () => {
      disposed = true;
      reconnectRef.current = () => {};

      const currentResources = resourcesRef.current;
      if (currentResources) {
        currentResources.resizeObserver?.disconnect();
        currentResources.attachAddon?.dispose();
        currentResources.attachAddon = null;

        if (currentResources.socket) {
          try {
            closingRef.current = true;
            currentResources.socket.close();
          } catch {
            // ignore
          }
          currentResources.socket = null;
        }

        currentResources.webglAddon?.dispose?.();
        currentResources.term.dispose();
      }

      resourcesRef.current = null;
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [terminalId, backendOrigin, fitAndMaybeResize]);

  useEffect(() => {
    if (!isActive) return;
    const resources = resourcesRef.current;
    if (!resources) return;
    resources.term.focus();
    window.requestAnimationFrame(() => {
      fitAndMaybeResize();
    });
  }, [isActive, fitAndMaybeResize]);

  const handleReconnect = useCallback(() => {
    reconnectRef.current();
  }, []);

  useEffect(() => {
    if (isClosing) {
      setStatusDetail("Closing terminal");
    }
  }, [isClosing]);

  const statusMessage = useMemo(() => {
    if (isClosing) {
      return "Closing…";
    }

    switch (status) {
      case "connected":
        return "Connected";
      case "connecting":
        return "Connecting…";
      case "disconnected":
        return "Disconnected";
      case "error":
        return "Error";
      default:
        return "";
    }
  }, [status, isClosing]);

  const showReconnect =
    !isClosing && (status === "disconnected" || status === "error");

  return (
    <div
      className={clsx(
        "absolute inset-0 flex flex-col transition-opacity duration-150",
        isActive
          ? "opacity-100"
          : "pointer-events-none opacity-0"
      )}
      aria-hidden={!isActive}
    >
      <div className="flex items-center justify-between border-b border-neutral-800/60 bg-neutral-950 px-4 py-2">
        <div className="text-xs text-neutral-300">
          <span className="font-medium text-neutral-100">{label}</span>
          <span className="ml-2 text-neutral-400">{statusMessage}</span>
        </div>
        {statusDetail && (
          <span className="text-[10px] text-neutral-500">{statusDetail}</span>
        )}
      </div>
      <div ref={containerRef} className="relative flex-1 min-h-0 bg-neutral-950">
        <div ref={surfaceRef} className="absolute inset-0" />
        <div
          className={clsx(
            "absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/85 text-sm text-neutral-200 transition-opacity",
            status === "connected" && !isClosing ? "pointer-events-none opacity-0" : "opacity-100"
          )}
        >
          <span>{statusMessage}</span>
          {statusDetail && status !== "connected" ? (
            <span className="text-xs text-neutral-400">{statusDetail}</span>
          ) : null}
          {showReconnect ? (
            <button
              type="button"
              onClick={handleReconnect}
              className="rounded border border-neutral-500/60 px-3 py-1 text-xs text-neutral-200 transition hover:bg-neutral-800"
            >
              Reconnect
            </button>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-neutral-800/60 bg-neutral-950 px-4 py-2 text-[11px] text-neutral-500">
        <span>Shift+Insert to paste</span>
        <span>Ctrl+Shift+F to search</span>
      </div>
    </div>
  );
}
