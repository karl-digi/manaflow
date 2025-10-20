import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { AttachAddon } from "@xterm/addon-attach";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import clsx from "clsx";
import { RefreshCw } from "lucide-react";

import "@xterm/xterm/css/xterm.css";

interface DevTerminalPanelProps {
  baseUrl: string | null;
  isOpen: boolean;
  target?: string;
  className?: string;
}

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

function buildUrl(base: string, path: string): string {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const sanitizedPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(sanitizedPath, normalizedBase);
  return url.toString();
}

function buildWsUrl(base: string, wsPath: string): string {
  const httpUrl = buildUrl(base, wsPath);
  const url = new URL(httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function DevTerminalPanel({
  baseUrl,
  isOpen,
  target = "cmux:dev",
  className,
}: DevTerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const attachAddonRef = useRef<AttachAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const currentBaseRef = useRef<string | null>(null);
  const isConnectingRef = useRef(false);
  const isOpenedRef = useRef(false);
  const isCleaningUpRef = useRef(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastDimensionsRef = useRef<{ cols: number; rows: number } | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const statusText = useMemo(() => {
    switch (status) {
      case "connecting":
        return "Connecting";
      case "connected":
        return "Connected";
      case "error":
        return error ?? "Connection error";
      default:
        return baseUrl ? "Idle" : "URL unavailable";
    }
  }, [status, error, baseUrl]);

  const ensureTerminal = useCallback(() => {
    if (terminalRef.current) return;

    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: true,
      cursorBlink: true,
      scrollback: 16000,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", Menlo, monospace',
      theme: {
        background: "#0f172a",
        foreground: "#e2e8f0",
        cursor: "#38bdf8",
        selection: "rgba(56, 189, 248, 0.35)",
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();
    const unicodeAddon = new Unicode11Addon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(unicodeAddon);
    unicodeAddon.activate(terminal);

    try {
      const webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
      webglAddonRef.current = webglAddon;
    } catch (addonError) {
      console.warn("Failed to load WebGL addon", addonError);
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
  }, []);

  const disposeTerminal = useCallback(() => {
    attachAddonRef.current?.dispose();
    attachAddonRef.current = null;

    webglAddonRef.current?.dispose();
    webglAddonRef.current = null;

    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitAddonRef.current = null;
    isOpenedRef.current = false;
  }, []);

  const sendResize = useCallback(() => {
    const socket = socketRef.current;
    const fitAddon = fitAddonRef.current;
    const container = containerRef.current;

    if (!fitAddon || !container) {
      return;
    }

    // Skip resize when panel is hidden (zero sized)
    if (container.offsetParent === null) {
      return;
    }

    fitAddon.fit();
    const dims = fitAddon.proposeDimensions();
    if (!dims || dims.cols <= 0 || dims.rows <= 0) {
      return;
    }

    const last = lastDimensionsRef.current;
    const changed = !last || last.cols !== dims.cols || last.rows !== dims.rows;
    lastDimensionsRef.current = { cols: dims.cols, rows: dims.rows };

    if (socket && socket.readyState === WebSocket.OPEN && changed) {
      const message = JSON.stringify({
        type: "resize",
        cols: dims.cols,
        rows: dims.rows,
      });
      try {
        socket.send(message);
      } catch (sendError) {
        console.warn("Failed to send resize message", sendError);
      }
    }
  }, []);

  const handleSocketOpen = useCallback(() => {
    setStatus("connected");
    setError(null);
    sendResize();
  }, [sendResize]);

  const handleSocketClose = useCallback(
    (event: CloseEvent) => {
      socketRef.current = null;
      attachAddonRef.current?.dispose();
      attachAddonRef.current = null;

      if (!isCleaningUpRef.current) {
        setStatus("error");
        setError(
          event.code === 1000
            ? "Connection closed"
            : `Connection closed (code ${event.code})`,
        );
      } else {
        setStatus("idle");
      }
    },
    [],
  );

  const handleSocketError = useCallback((event: Event) => {
    console.error("Dev terminal socket error", event);
    setStatus("error");
    setError("Connection error");
  }, []);

  const detachSocket = useCallback(() => {
    const socket = socketRef.current;
    if (socket) {
      socket.removeEventListener("open", handleSocketOpen);
      socket.removeEventListener("close", handleSocketClose);
      socket.removeEventListener("error", handleSocketError);
      try {
        socket.close();
      } catch (closeError) {
        console.warn("Failed to close dev terminal socket", closeError);
      }
    }
    socketRef.current = null;
  }, [handleSocketClose, handleSocketError, handleSocketOpen]);

  const cleanupSession = useCallback(async () => {
    if (isCleaningUpRef.current) return;
    isCleaningUpRef.current = true;

    detachSocket();

    if (sessionIdRef.current && currentBaseRef.current) {
      try {
        const deleteUrl = buildUrl(
          currentBaseRef.current,
          `api/tabs/${sessionIdRef.current}`,
        );
        await fetch(deleteUrl, { method: "DELETE" });
      } catch (deleteError) {
        console.warn("Failed to delete terminal session", deleteError);
      }
    }

    sessionIdRef.current = null;
    currentBaseRef.current = null;
    attachAddonRef.current = null;
    lastDimensionsRef.current = null;
    setStatus((prev) => (prev === "connected" ? "idle" : prev));

    isCleaningUpRef.current = false;
  }, [detachSocket]);

  const connectSession = useCallback(async () => {
    if (!baseUrl || !isOpen) {
      return;
    }

    if (isConnectingRef.current) {
      return;
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    ensureTerminal();

    const container = containerRef.current;
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;

    if (!container || !terminal || !fitAddon) {
      return;
    }

    if (!isOpenedRef.current) {
      terminal.open(container);
      isOpenedRef.current = true;
    }

    fitAddon.fit();
    const dims = fitAddon.proposeDimensions();
    const cols = dims?.cols ?? 80;
    const rows = dims?.rows ?? 24;
    lastDimensionsRef.current = { cols, rows };

    setStatus("connecting");
    setError(null);
    isConnectingRef.current = true;

    try {
      const createUrl = buildUrl(baseUrl, "api/tabs");
      const response = await fetch(createUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cols,
          rows,
          cmd: "tmux",
          args: ["attach-session", "-t", target],
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const payload = (await response.json()) as {
        id: string;
        ws_url: string;
      };

      sessionIdRef.current = payload.id;
      currentBaseRef.current = baseUrl;

      const wsUrl = buildWsUrl(baseUrl, payload.ws_url);
      const socket = new WebSocket(wsUrl);
      socket.binaryType = "arraybuffer";

      socket.addEventListener("open", handleSocketOpen);
      socket.addEventListener("close", handleSocketClose);
      socket.addEventListener("error", handleSocketError);

      socketRef.current = socket;

      const attachAddon = new AttachAddon(socket, { bidirectional: true });
      attachAddonRef.current = attachAddon;
      terminal.loadAddon(attachAddon);
    } catch (connectError) {
      console.error("Failed to connect dev terminal", connectError);
      setStatus("error");
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Failed to connect",
      );
      await cleanupSession();
    } finally {
      isConnectingRef.current = false;
    }
  }, [
    baseUrl,
    isOpen,
    target,
    ensureTerminal,
    handleSocketClose,
    handleSocketError,
    handleSocketOpen,
    cleanupSession,
  ]);

  useEffect(() => {
    if (!isOpen || !baseUrl) {
      return;
    }

    void connectSession();
  }, [isOpen, baseUrl, connectSession]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!resizeObserverRef.current && containerRef.current) {
      const observer = new ResizeObserver(() => {
        sendResize();
      });
      observer.observe(containerRef.current);
      resizeObserverRef.current = observer;
    }

    const handleWindowResize = () => {
      sendResize();
    };

    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [isOpen, sendResize]);

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      void cleanupSession();
      detachSocket();
      disposeTerminal();
    };
  }, [cleanupSession, detachSocket, disposeTerminal]);

  useEffect(() => {
    if (!baseUrl && sessionIdRef.current) {
      void cleanupSession();
    }
  }, [baseUrl, cleanupSession]);

  const handleReconnect = useCallback(() => {
    void (async () => {
      await cleanupSession();
      await connectSession();
    })();
  }, [cleanupSession, connectSession]);

  const showOverlay = !baseUrl || status === "error" || status === "connecting";

  return (
    <div
      className={clsx(
        "flex h-full flex-col overflow-hidden rounded-md border border-neutral-800 bg-neutral-950",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Dev Terminal
          </span>
          <span
            className={clsx("text-xs", {
              "text-neutral-400": status === "idle",
              "text-amber-400": status === "connecting",
              "text-emerald-400": status === "connected",
              "text-rose-400": status === "error",
            })}
          >
            {statusText}
          </span>
        </div>
        <button
          type="button"
          onClick={handleReconnect}
          disabled={!baseUrl || status === "connecting"}
          className={clsx(
            "inline-flex items-center gap-1 rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-300",
            !baseUrl || status === "connecting"
              ? "opacity-40"
              : "hover:border-neutral-700 hover:text-neutral-100",
          )}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reconnect
        </button>
      </div>
      <div className="relative flex-1 bg-neutral-950">
        <div
          ref={containerRef}
          className={clsx("h-full w-full", {
            hidden: !isOpen,
          })}
        />
        {showOverlay && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-neutral-950/80 px-4 text-center">
            <p className="text-xs text-neutral-400">
              {status === "connecting"
                ? "Connecting to dev terminal…"
                : error ?? "Dev terminal unavailable"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
