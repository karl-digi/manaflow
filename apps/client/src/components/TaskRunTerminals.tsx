import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { createTerminalOptions } from "@cmux/shared/terminal-config";
import { AttachAddon } from "@xterm/addon-attach";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const REFRESH_INTERVAL_MS = 10_000;

type TerminalStatus = "connecting" | "open" | "closed" | "error";

function getStatusLabel(status?: TerminalStatus): string {
  switch (status) {
    case "open":
      return "Connected";
    case "closed":
      return "Disconnected";
    case "error":
      return "Error";
    default:
      return "Connecting";
  }
}

function getStatusTone(status?: TerminalStatus): string {
  switch (status) {
    case "open":
      return "bg-emerald-500";
    case "closed":
      return "bg-neutral-500";
    case "error":
      return "bg-red-500";
    default:
      return "bg-amber-400";
  }
}

interface TaskRunTerminalsProps {
  baseUrl: string | null;
  taskRunId: string;
}

export function TaskRunTerminals({ baseUrl, taskRunId }: TaskRunTerminalsProps) {
  const {
    data,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery<string[]>({
    queryKey: ["task-run-terminals", taskRunId, baseUrl],
    queryFn: async ({ signal }) => {
      if (!baseUrl) {
        return [];
      }
      const url = new URL("/api/tabs", baseUrl);
      const response = await fetch(url, {
        signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Failed to load terminals (${response.status})`);
      }
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) {
        throw new Error("Unexpected response when loading terminals");
      }
      return payload.map((value) => String(value));
    },
    enabled: Boolean(baseUrl),
    refetchInterval: baseUrl ? REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: true,
    staleTime: 5_000,
  });

  const terminalIds = data ?? [];
  const [activeTab, setActiveTab] = useState<string | null>(null);
  useEffect(() => {
    if (terminalIds.length === 0) {
      setActiveTab(null);
      return;
    }
    setActiveTab((previous) =>
      previous && terminalIds.includes(previous) ? previous : terminalIds[0]
    );
  }, [terminalIds]);

  const [statusById, setStatusById] = useState<Record<string, TerminalStatus>>({});
  const handleStatusChange = useCallback(
    (id: string, status: TerminalStatus) => {
      setStatusById((prev) => {
        if (prev[id] === status) {
          return prev;
        }
        return { ...prev, [id]: status };
      });
    },
    []
  );

  const renderContent = useMemo(() => {
    if (!baseUrl) {
      return (
        <EmptyState
          title="Terminals unavailable"
          description="Workspace URL missing or unsupported provider."
        />
      );
    }
    if (isPending) {
      return (
        <EmptyState
          title="Loading terminals"
          description="Fetching available terminal sessions..."
        />
      );
    }
    if (isError) {
      return (
        <EmptyState
          title="Failed to load terminals"
          description={error instanceof Error ? error.message : "Unknown error"}
          variant="error"
        />
      );
    }
    if (terminalIds.length === 0) {
      return (
        <EmptyState
          title="No terminals yet"
          description="Open a terminal in the workspace to view it here."
        />
      );
    }
    if (!activeTab) {
      return null;
    }
    return null;
  }, [
    activeTab,
    baseUrl,
    error,
    isError,
    isPending,
    terminalIds.length,
  ]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 overflow-x-auto border-b border-neutral-200/80 dark:border-neutral-800/60 bg-neutral-50 dark:bg-neutral-900/40 px-3 py-2">
        <div className="flex items-center gap-1">
          {terminalIds.map((id, index) => {
            const isActive = id === activeTab;
            const status = statusById[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={clsx(
                  "flex items-center gap-2 rounded-md px-3 py-1 text-xs font-medium transition",
                  isActive
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-950 dark:text-neutral-100"
                    : "bg-transparent text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800/60"
                )}
              >
                <span className="whitespace-nowrap">Terminal {index + 1}</span>
                <span
                  className={clsx(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    isActive
                      ? "bg-neutral-900 text-neutral-50 dark:bg-neutral-100 dark:text-neutral-900"
                      : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                  )}
                >
                  <span
                    className={clsx(
                      "h-2 w-2 rounded-full",
                      getStatusTone(status)
                    )}
                  />
                  {getStatusLabel(status)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
            className="rounded-md border border-neutral-200/80 bg-white px-2 py-1 text-xs text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-800/60 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900"
          >
            Refresh
          </button>
        </div>
      </div>
      <div className="flex-1 relative bg-neutral-950">
        {renderContent}
        {baseUrl && activeTab
          ? terminalIds.map((id) => (
              <div
                key={id}
                className={clsx(
                  "absolute inset-0",
                  id === activeTab ? "opacity-100" : "pointer-events-none opacity-0"
                )}
              >
                <RemoteTerminalSession
                  baseUrl={baseUrl}
                  tabId={id}
                  isActive={id === activeTab}
                  onStatusChange={handleStatusChange}
                />
              </div>
            ))
          : null}
      </div>
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  variant?: "default" | "error";
}

function EmptyState({ title, description, variant = "default" }: EmptyStateProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
      <h3
        className={clsx(
          "text-sm font-semibold",
          variant === "error"
            ? "text-red-500 dark:text-red-400"
            : "text-neutral-600 dark:text-neutral-200"
        )}
      >
        {title}
      </h3>
      <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-md">
        {description}
      </p>
    </div>
  );
}

interface RemoteTerminalSessionProps {
  baseUrl: string;
  tabId: string;
  isActive: boolean;
  onStatusChange?: (id: string, status: TerminalStatus) => void;
}

function RemoteTerminalSession({
  baseUrl,
  tabId,
  isActive,
  onStatusChange,
}: RemoteTerminalSessionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const attachAddonRef = useRef<AttachAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const [terminalReady, setTerminalReady] = useState(false);
  const [status, setStatus] = useState<TerminalStatus>("connecting");

  useEffect(() => {
    onStatusChange?.(tabId, status);
  }, [onStatusChange, status, tabId]);

  const sendResize = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;
    const socket = socketRef.current;
    if (!terminal) {
      return;
    }
    fitAddon?.fit();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const dims = normalizeDimensions(terminal.cols, terminal.rows);
    socket.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const terminal = new Terminal(
      createTerminalOptions({
        scrollback: 100_000,
        cursorBlink: true,
      })
    );
    const fitAddon = new FitAddon();
    const unicodeAddon = new Unicode11Addon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(unicodeAddon);
    unicodeAddon.activate(terminal);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);

    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose();
        webglAddon = null;
      });
    } catch {
      webglAddon = null;
    }

    terminal.open(element);
    fitAddon.fit();

    const resizeObserver = new ResizeObserver(() => {
      sendResize();
    });
    resizeObserver.observe(element);

    const handleWindowResize = () => {
      sendResize();
    };
    window.addEventListener("resize", handleWindowResize);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    resizeObserverRef.current = resizeObserver;
    setTerminalReady(true);

    return () => {
      setTerminalReady(false);
      window.removeEventListener("resize", handleWindowResize);
      resizeObserver.disconnect();
      resizeObserverRef.current = null;

      closingRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();

      const attach = attachAddonRef.current;
      attachAddonRef.current = null;
      attach?.dispose();

      fitAddonRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
      if (webglAddon) {
        webglAddon.dispose();
      }
    };
  }, [sendResize, tabId]);

  useEffect(() => {
    if (!terminalReady) {
      return;
    }
    closingRef.current = false;
    let cancelled = false;

    const connect = () => {
      if (cancelled) {
        return;
      }
      const wsUrl = new URL(`/ws/${tabId}`, baseUrl);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

      const socket = new WebSocket(wsUrl);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      setStatus("connecting");

      const attach = new AttachAddon(socket, { bidirectional: true });
      attachAddonRef.current?.dispose();
      attachAddonRef.current = attach;
      terminalRef.current?.loadAddon(attach);

      socket.addEventListener("open", () => {
        if (cancelled) {
          return;
        }
        setStatus("open");
        sendResize();
        window.setTimeout(sendResize, 120);
      });

      socket.addEventListener("error", () => {
        if (cancelled) {
          return;
        }
        setStatus("error");
      });

      socket.addEventListener("close", () => {
        attach.dispose();
        if (cancelled) {
          return;
        }
        socketRef.current = null;
        attachAddonRef.current = null;
        if (closingRef.current) {
          setStatus("closed");
          return;
        }
        setStatus("closed");
        reconnectTimerRef.current = window.setTimeout(connect, 1500);
      });
    };

    connect();

    return () => {
      cancelled = true;
      closingRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
      const attach = attachAddonRef.current;
      attachAddonRef.current = null;
      attach?.dispose();
    };
  }, [baseUrl, sendResize, tabId, terminalReady]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    const handleFocus = () => {
      fitAddonRef.current?.fit();
      terminalRef.current?.focus();
      sendResize();
    };
    const id = window.requestAnimationFrame(handleFocus);
    return () => {
      window.cancelAnimationFrame(id);
    };
  }, [isActive, sendResize]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full bg-neutral-950/95"
        data-terminal-id={tabId}
      />
      {status !== "open" ? (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded bg-neutral-900/80 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-300 dark:bg-neutral-800/80">
          {getStatusLabel(status)}
        </div>
      ) : null}
    </div>
  );
}

function normalizeDimensions(cols: number, rows: number) {
  const safeCols = Number.isFinite(cols) && cols > 0 ? cols : 80;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 24;
  return {
    cols: Math.max(20, Math.min(320, Math.round(safeCols))),
    rows: Math.max(8, Math.min(120, Math.round(safeRows))),
  };
}
