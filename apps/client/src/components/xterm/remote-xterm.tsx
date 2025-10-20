import { createTerminalOptions } from "@cmux/shared/terminal-config";
import { AttachAddon } from "@xterm/addon-attach";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ConnectionStatus =
  | "initializing"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type { ConnectionStatus as RemoteXtermConnectionStatus };

const DEFAULT_BASE_URL = "http://127.0.0.1:39383";
export const DEFAULT_XTERM_BASE_URL = DEFAULT_BASE_URL;

function buildWebSocketUrl(baseUrl: string, terminalId: string): string {
  const url = new URL(`/ws/${terminalId}`, baseUrl);
  url.search = "";
  url.hash = "";
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

interface StatusBadgeProps {
  status: ConnectionStatus;
  errorMessage: string | null;
}

function StatusBadge({ status, errorMessage }: StatusBadgeProps) {
  const message = useMemo(() => {
    switch (status) {
      case "initializing":
        return "Starting terminal…";
      case "connecting":
        return "Connecting…";
      case "connected":
        return "Connected";
      case "disconnected":
        return "Disconnected";
      case "error":
        return errorMessage ?? "Connection error";
      default:
        return "";
    }
  }, [errorMessage, status]);

  if (!message || status === "connected") {
    return null;
  }

  return (
    <span className="rounded bg-neutral-900/80 px-2 py-1 text-[11px] font-medium text-neutral-200 shadow-md dark:bg-neutral-900/90">
      {message}
    </span>
  );
}

interface RemoteXtermProps {
  terminalId: string;
  isActive: boolean;
  baseUrl?: string;
  className?: string;
  onStatusChange?: (status: ConnectionStatus) => void;
}

export function RemoteXterm({
  terminalId,
  isActive,
  baseUrl = DEFAULT_BASE_URL,
  className,
  onStatusChange,
}: RemoteXtermProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const attachAddonRef = useRef<AttachAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const socketCleanupRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(false);
  const [terminalReady, setTerminalReady] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("initializing");
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!onStatusChange) {
      return;
    }
    onStatusChange(connectionStatus);
  }, [connectionStatus, onStatusChange]);

  const releaseSocket = useCallback(() => {
    const cleanup = socketCleanupRef.current;
    if (cleanup) {
      cleanup();
      socketCleanupRef.current = null;
    }

    const attachAddon = attachAddonRef.current;
    if (attachAddon) {
      attachAddon.dispose();
      attachAddonRef.current = null;
    }

    const socket = socketRef.current;
    if (socket) {
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
      socketRef.current = null;
    }
  }, []);

  const fitAndResize = useCallback(() => {
    const term = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) {
      return;
    }

    fitAddon.fit();

    const cols = term.cols;
    const rows = term.rows;
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
      return;
    }

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        type: "resize",
        cols,
        rows,
      });
      socket.send(message);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal(
      createTerminalOptions({
        cursorBlink: true,
        scrollback: 8000,
      })
    );
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();
    const unicodeAddon = new Unicode11Addon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(unicodeAddon);
    unicodeAddon.activate(terminal);

    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
    } catch {
      webglAddon = null;
    }

    terminal.open(container);

    fitAddonRef.current = fitAddon;
    terminalRef.current = terminal;
    webglAddonRef.current = webglAddon;

    const resizeObserver = new ResizeObserver(() => {
      fitAndResize();
    });
    resizeObserver.observe(container);
    resizeObserverRef.current = resizeObserver;

    const handleWindowResize = () => {
      fitAndResize();
    };
    window.addEventListener("resize", handleWindowResize);

    if (isMountedRef.current) {
      setTerminalReady(true);
    }

    fitAndResize();

    return () => {
      if (isMountedRef.current) {
        setTerminalReady(false);
      }
      resizeObserver.disconnect();
      resizeObserverRef.current = null;
      window.removeEventListener("resize", handleWindowResize);

      releaseSocket();

      if (webglAddon) {
        webglAddon.dispose();
      }

      terminal.dispose();
      fitAddonRef.current = null;
      terminalRef.current = null;
      webglAddonRef.current = null;
    };
  }, [fitAndResize, releaseSocket]);

  useEffect(() => {
    if (!terminalReady || !terminalRef.current) {
      return;
    }

    releaseSocket();

    const socketUrl = buildWebSocketUrl(baseUrl, terminalId);
    let socket: WebSocket;
    try {
      socket = new WebSocket(socketUrl);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to connect to terminal";
      if (isMountedRef.current) {
        setConnectionStatus("error");
        setConnectionError(message);
      }
      return;
    }

    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    const attachAddon = new AttachAddon(socket, { bidirectional: true });
    attachAddonRef.current = attachAddon;
    terminalRef.current.loadAddon(attachAddon);

    const handleOpen = () => {
      if (!isMountedRef.current) {
        return;
      }
      setConnectionStatus("connected");
      setConnectionError(null);
      fitAndResize();
      window.setTimeout(() => {
        fitAndResize();
      }, 32);
    };

    const handleClose = () => {
      if (!isMountedRef.current) {
        return;
      }
      setConnectionStatus("disconnected");
    };

    const handleError = () => {
      if (!isMountedRef.current) {
        return;
      }
      setConnectionStatus("error");
      setConnectionError("Connection error");
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);

    socketCleanupRef.current = () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleError);
    };

    if (isMountedRef.current) {
      setConnectionStatus("connecting");
      setConnectionError(null);
    }

    return () => {
      releaseSocket();
    };
  }, [baseUrl, fitAndResize, releaseSocket, terminalId, terminalReady]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const term = terminalRef.current;
    if (!term) {
      return;
    }

    fitAndResize();
    window.requestAnimationFrame(() => {
      term.focus();
    });
  }, [fitAndResize, isActive]);

  return (
    <div
      className={clsx(
        "relative h-full w-full bg-neutral-950 text-neutral-100",
        className
      )}
    >
      <div ref={containerRef} className="h-full w-full" role="presentation" />
      <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
        <StatusBadge status={connectionStatus} errorMessage={connectionError} />
      </div>
    </div>
  );
}
