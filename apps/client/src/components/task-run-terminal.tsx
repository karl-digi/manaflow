import { useXTerm } from "@/components/xterm/use-xterm";
import { FitAddon } from "@xterm/addon-fit";
import { AttachAddon } from "@xterm/addon-attach";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

const MIN_COLS = 20;
const MAX_COLS = 320;
const MIN_ROWS = 8;
const MAX_ROWS = 120;

function normalizeDimensions(cols: number, rows: number) {
  const safeCols = Number.isFinite(cols) && cols > 0 ? cols : 80;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 24;
  return {
    cols: Math.max(MIN_COLS, Math.min(MAX_COLS, Math.round(safeCols))),
    rows: Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.round(safeRows))),
  };
}

function ensureTrailingSlash(value: string): string {
  if (value.endsWith("/")) {
    return value;
  }
  return `${value}/`;
}

type ConnectionStatus =
  | "idle"
  | "starting"
  | "connecting"
  | "connected"
  | "error";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: "Idle",
  starting: "Starting…",
  connecting: "Connecting…",
  connected: "Connected",
  error: "Disconnected",
};

export interface TaskRunTerminalProps {
  /** HTTP endpoint for the cmux-xterm service (e.g. https://example.com/) */
  endpoint: string;
  /** Optional label for the terminal header */
  title?: string;
}

export function TaskRunTerminal({
  endpoint,
  title = "Terminal",
}: TaskRunTerminalProps) {
  const fitAddon = useMemo(() => new FitAddon(), []);
  const webLinksAddon = useMemo(() => new WebLinksAddon(), []);
  const addons = useMemo(() => [fitAddon, webLinksAddon], [fitAddon, webLinksAddon]);

  const { ref: xtermRef, instance: terminal } = useXTerm({
    addons,
    options: {
      convertEol: true,
      scrollback: 100_000,
    },
  });

  const socketRef = useRef<WebSocket | null>(null);
  const attachAddonRef = useRef<AttachAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const focusTerminal = useCallback(() => {
    if (!terminal) return;
    terminal.focus();
  }, [terminal]);

  const measureDimensions = useCallback(() => {
    if (!terminal) {
      return { cols: 80, rows: 24 };
    }
    fitAddon.fit();
    return normalizeDimensions(terminal.cols, terminal.rows);
  }, [fitAddon, terminal]);

  const sendResize = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !terminal) {
      return;
    }
    const dims = measureDimensions();
    try {
      socket.send(
        JSON.stringify({
          type: "resize",
          cols: dims.cols,
          rows: dims.rows,
        })
      );
    } catch {
      // Swallow send errors; they'll be surfaced via socket events if critical.
    }
  }, [measureDimensions, terminal]);

  useEffect(() => {
    if (!terminal) return;

    const element = (xtermRef as MutableRefObject<HTMLDivElement | null>).current;
    if (!element) return;

    const handleResize = () => {
      measureDimensions();
      sendResize();
    };

    const observer = new ResizeObserver(() => {
      handleResize();
    });
    observer.observe(element);

    const onWindowResize = () => {
      handleResize();
    };
    window.addEventListener("resize", onWindowResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [measureDimensions, sendResize, terminal, xtermRef]);

  const disconnectSession = useCallback(
    async (baseUrl: URL) => {
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;

      attachAddonRef.current?.dispose();
      attachAddonRef.current = null;

      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        try {
          socket.close();
        } catch {
          // ignore
        }
      }

      if (sessionId) {
        const deleteUrl = new URL(`api/tabs/${sessionId}`, baseUrl);
        try {
          await fetch(deleteUrl.toString(), { method: "DELETE" });
        } catch {
          // ignore cleanup failures
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!terminal) return;

    let parsedBase: URL;
    try {
      parsedBase = new URL(ensureTrailingSlash(endpoint));
    } catch (error) {
      console.error("[TaskRunTerminal] Invalid endpoint", endpoint, error);
      setStatus("error");
      setErrorMessage("Invalid terminal endpoint");
      return;
    }

    let disposed = false;
    const abortController = new AbortController();

    const connect = async () => {
      setStatus("starting");
      setErrorMessage(null);

      terminal.clear();
      measureDimensions();

      const createUrl = new URL("api/tabs", parsedBase);
      let response: Response;
      const dims = measureDimensions();

      try {
        response = await fetch(createUrl.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dims),
          signal: abortController.signal,
        });
      } catch (error) {
        if (disposed) return;
        console.error("[TaskRunTerminal] Failed to create terminal", error);
        setStatus("error");
        setErrorMessage("Failed to start terminal session");
        return;
      }

      if (disposed) {
        void disconnectSession(parsedBase);
        return;
      }

      if (!response.ok) {
        setStatus("error");
        setErrorMessage(`Request failed (${response.status})`);
        return;
      }

      let payload: { id: string; ws_url: string };
      try {
        payload = (await response.json()) as { id: string; ws_url: string };
      } catch (error) {
        if (disposed) return;
        console.error("[TaskRunTerminal] Invalid response", error);
        setStatus("error");
        setErrorMessage("Invalid terminal response");
        return;
      }

      sessionIdRef.current = payload.id;
      setStatus("connecting");

      const wsUrl = new URL(payload.ws_url, parsedBase);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrl);
      } catch (error) {
        if (disposed) return;
        console.error("[TaskRunTerminal] Failed to open websocket", error);
        setStatus("error");
        setErrorMessage("Failed to connect to terminal");
        return;
      }

      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      const attachAddon = new AttachAddon(socket, { bidirectional: true });
      attachAddonRef.current?.dispose();
      attachAddonRef.current = attachAddon;
      terminal.loadAddon(attachAddon);

      socket.addEventListener("open", () => {
        if (disposed) return;
        setStatus("connected");
        measureDimensions();
        sendResize();
        focusTerminal();
      });

      socket.addEventListener("close", () => {
        if (disposed) return;
        setStatus("error");
        setErrorMessage("Terminal disconnected");
      });

      socket.addEventListener("error", () => {
        if (disposed) return;
        setStatus("error");
        setErrorMessage("Terminal connection error");
      });
    };

    void connect();

    return () => {
      disposed = true;
      abortController.abort();
      void disconnectSession(parsedBase);
    };
  }, [attempt, disconnectSession, endpoint, focusTerminal, measureDimensions, sendResize, terminal]);

  useEffect(() => {
    if (!terminal) return;
    fitAddon.fit();
  }, [fitAddon, terminal]);

  const statusLabel = STATUS_LABEL[status];
  const showOverlay = status !== "connected";

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50 dark:bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        <div className="flex items-center gap-2">
          <span className="font-semibold normal-case text-neutral-700 dark:text-neutral-200">
            {title}
          </span>
          <span className="rounded bg-neutral-200/80 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800/80 dark:text-neutral-300">
            {statusLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {errorMessage ? (
            <span className="text-[11px] text-red-500 dark:text-red-400">
              {errorMessage}
            </span>
          ) : null}
          <button
            type="button"
            className="rounded border border-neutral-300 px-2 py-1 text-[11px] font-medium text-neutral-600 transition hover:bg-neutral-200/70 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800/70"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Reconnect
          </button>
        </div>
      </div>
      <div className="relative flex-1">
        <div
          ref={xtermRef}
          className="h-full w-full"
          style={{ backgroundColor: "#1e1e1e" }}
          onClick={focusTerminal}
        />
        <div
          className={clsx(
            "pointer-events-none absolute inset-0 flex items-center justify-center bg-neutral-900/70 text-sm text-neutral-200 transition-opacity",
            showOverlay ? "opacity-100" : "opacity-0"
          )}
          aria-hidden={!showOverlay}
        >
          {statusLabel}
        </div>
      </div>
    </div>
  );
}
