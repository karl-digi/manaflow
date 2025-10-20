import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { AttachAddon } from "@xterm/addon-attach";
import clsx from "clsx";

import { useXTerm } from "./xterm/use-xterm";

import "@xterm/xterm/css/xterm.css";

const XTERM_PORT = 39383;
const QUERY_KEY = ["xterm", "tabs"] as const;

const DIMENSION_LIMITS = {
  minCols: 20,
  maxCols: 320,
  minRows: 8,
  maxRows: 120,
} as const;

type ConnectionStatus = "connecting" | "open" | "closed" | "error";

type TerminalId = string;

function resolveXtermHttpBase(): string {
  if (typeof window === "undefined") {
    return `http://127.0.0.1:${XTERM_PORT}`;
  }

  const { protocol, hostname } = window.location;
  const base = new URL(`${protocol}//${hostname}`);
  base.port = String(XTERM_PORT);
  return `${base.protocol}//${base.host}`;
}

function buildHttpUrl(base: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function buildWsUrl(base: string, path: string): string {
  const httpUrl = new URL(buildHttpUrl(base, path));
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  return httpUrl.toString();
}

function sanitizeDimensions(cols: number, rows: number) {
  const safeCols = Number.isFinite(cols) && cols > 0 ? cols : 80;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 24;
  return {
    cols: Math.max(
      DIMENSION_LIMITS.minCols,
      Math.min(DIMENSION_LIMITS.maxCols, Math.round(safeCols)),
    ),
    rows: Math.max(
      DIMENSION_LIMITS.minRows,
      Math.min(DIMENSION_LIMITS.maxRows, Math.round(safeRows)),
    ),
  };
}

async function fetchTerminalIds(baseUrl: string): Promise<TerminalId[]> {
  const response = await fetch(buildHttpUrl(baseUrl, "/api/tabs"), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to load terminal tabs (${response.status})`);
  }

  const payload = (await response.json()) as TerminalId[];
  return payload.map((value) => value.toString());
}

interface TaskRunTerminalSessionProps {
  terminalId: TerminalId;
  isActive: boolean;
  baseUrl: string;
}

function TaskRunTerminalSession({
  terminalId,
  isActive,
  baseUrl,
}: TaskRunTerminalSessionProps) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  const fitAddon = useMemo(() => new FitAddon(), []);
  const webLinksAddon = useMemo(() => new WebLinksAddon(), []);
  const searchAddon = useMemo(() => new SearchAddon(), []);
  const unicodeAddon = useMemo(() => new Unicode11Addon(), []);
  const webglAddon = useMemo(() => {
    try {
      return new WebglAddon();
    } catch (error) {
      console.warn("Failed to initialize xterm WebGL addon", error);
      return null;
    }
  }, []);

  const addons = useMemo(() => {
    const loaded = [fitAddon, webLinksAddon, searchAddon, unicodeAddon];
    if (webglAddon) {
      loaded.push(webglAddon);
    }
    return loaded;
  }, [fitAddon, webLinksAddon, searchAddon, unicodeAddon, webglAddon]);

  const socketRef = useRef<WebSocket | null>(null);
  const attachAddonRef = useRef<AttachAddon | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const sendResize = useCallback(
    (cols: number, rows: number) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const dims = sanitizeDimensions(cols, rows);
      socket.send(
        JSON.stringify({
          type: "resize",
          cols: dims.cols,
          rows: dims.rows,
        }),
      );
    },
    [],
  );

  const listeners = useMemo(
    () => ({
      onResize: ({ cols, rows }: { cols: number; rows: number }) => {
        sendResize(cols, rows);
      },
    }),
    [sendResize],
  );

  const { ref, instance } = useXTerm({
    addons,
    listeners,
  });

  const performFit = useCallback(() => {
    if (!isActive || !instance) {
      return;
    }

    fitAddon.fit();
    const { cols, rows } = instance;
    sendResize(cols, rows);
    instance.focus();
  }, [fitAddon, instance, isActive, sendResize]);

  useEffect(() => {
    if (!instance) {
      return;
    }

    unicodeAddon.activate(instance);
  }, [instance, unicodeAddon]);

  useEffect(() => {
    if (!instance) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    const wsUrl = buildWsUrl(baseUrl, `/ws/${terminalId}`);
    const socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";

    socketRef.current = socket;
    setStatus("connecting");

    const attach = new AttachAddon(socket, { bidirectional: true });
    attachAddonRef.current = attach;
    instance.loadAddon(attach);

    const handleOpen = () => {
      if (cancelled) return;
      setStatus("open");
      animationFrameRef.current = window.requestAnimationFrame(() => {
        performFit();
        window.setTimeout(() => {
          if (!cancelled) {
            performFit();
          }
        }, 100);
      });
    };

    const handleClose = () => {
      if (!cancelled) {
        setStatus("closed");
      }
    };

    const handleError = () => {
      if (!cancelled) {
        setStatus("error");
      }
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);

    return () => {
      cancelled = true;
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleError);

      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      if (attachAddonRef.current) {
        attachAddonRef.current.dispose();
        attachAddonRef.current = null;
      }

      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }

      socketRef.current = null;
    };
  }, [baseUrl, instance, performFit, terminalId]);

  useEffect(() => {
    if (!instance) {
      return;
    }

    const element = ref.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver(() => {
      performFit();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [instance, performFit, ref]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = () => {
      performFit();
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [performFit]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      performFit();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isActive, performFit]);

  return (
    <div className="relative flex h-full w-full">
      <div
        ref={ref}
        className="h-full w-full bg-[#0f172a]"
        role="log"
        aria-live="polite"
      />
      {status !== "open" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-neutral-200">
          {status === "connecting" && "Connecting to terminal..."}
          {status === "closed" && "Terminal disconnected"}
          {status === "error" && "Terminal connection error"}
        </div>
      ) : null}
    </div>
  );
}

export function TaskRunTerminalsPane() {
  const isBrowser = typeof window !== "undefined";
  const baseUrl = useMemo(() => resolveXtermHttpBase(), []);

  const {
    data: tabs,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: [...QUERY_KEY, baseUrl],
    queryFn: () => fetchTerminalIds(baseUrl),
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
    enabled: isBrowser,
  });

  const [activeTab, setActiveTab] = useState<TerminalId | null>(null);

  useEffect(() => {
    if (!tabs || tabs.length === 0) {
      setActiveTab(null);
      return;
    }

    setActiveTab((current) => {
      if (current && tabs.includes(current)) {
        return current;
      }
      return tabs[0] ?? null;
    });
  }, [tabs]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex max-w-full gap-2 overflow-x-auto">
          {(tabs ?? []).map((tabId, index) => (
            <button
              key={tabId}
              type="button"
              onClick={() => setActiveTab(tabId)}
              className={clsx(
                "whitespace-nowrap rounded border px-3 py-1 text-xs font-medium transition-colors",
                activeTab === tabId
                  ? "border-blue-500 bg-blue-500 text-white"
                  : "border-transparent bg-neutral-200 text-neutral-700 hover:border-neutral-300 hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-700 dark:hover:bg-neutral-700",
              )}
            >
              {`Terminal ${index + 1}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 transition-colors hover:border-neutral-400 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:text-neutral-100"
          >
            {isFetching ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="relative flex-1 bg-neutral-950">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-400">
            Loading terminals...
          </div>
        ) : null}

        {isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-red-500">
            <span>
              {(error as Error)?.message ?? "Unable to load terminals."}
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded border border-red-500 px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-500 hover:text-white"
            >
              Try again
            </button>
          </div>
        ) : null}

        {!isLoading && !isError && (tabs?.length ?? 0) === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-neutral-400">
            No terminals are currently available. Start one from the cmux terminal service.
          </div>
        ) : null}

        {(tabs ?? []).map((tabId) => (
          <div
            key={tabId}
            className={clsx(
              "absolute inset-0",
              activeTab === tabId ? "flex" : "hidden",
            )}
            aria-hidden={activeTab !== tabId}
          >
            <TaskRunTerminalSession
              terminalId={tabId}
              isActive={activeTab === tabId}
              baseUrl={baseUrl}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
