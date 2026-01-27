import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  ACTIVE_TERMINAL_SCROLLBACK,
  INACTIVE_TERMINAL_SCROLLBACK,
} from "@cmux/shared/terminal-config";
import clsx from "clsx";
import { useXTerm } from "./xterm/use-xterm";

const MIN_COLS = 20;
const MAX_COLS = 320;
const MIN_ROWS = 8;
const MAX_ROWS = 120;
const CONTROL_MESSAGE_PREFIX = "\u0000";

type PtyControlMessage = {
  type: "output" | "exit" | "error";
  data?: string;
  exit_code?: number | null;
  exitCode?: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseControlMessage(text: string): PtyControlMessage | null {
  if (!text.startsWith(CONTROL_MESSAGE_PREFIX)) {
    return null;
  }
  try {
    const payload = JSON.parse(text.slice(1));
    if (!isRecord(payload)) {
      return null;
    }
    const type = payload.type;
    if (type !== "output" && type !== "exit" && type !== "error") {
      return null;
    }
    return {
      type,
      data: typeof payload.data === "string" ? payload.data : undefined,
      exit_code:
        typeof payload.exit_code === "number" || payload.exit_code === null
          ? payload.exit_code
          : undefined,
      exitCode:
        typeof payload.exitCode === "number" || payload.exitCode === null
          ? payload.exitCode
          : undefined,
    };
  } catch (error) {
    console.error("[TaskRunTerminalSession] Failed to parse control message", error);
    return null;
  }
}

async function decodeWsMessage(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (data instanceof Blob) {
    return data.text();
  }
  return "";
}

export type TerminalConnectionState =
  | "connecting"
  | "open"
  | "closed"
  | "error";

interface TaskRunTerminalSessionProps {
  baseUrl: string;
  terminalId: string;
  isActive: boolean;
  onConnectionStateChange?: (state: TerminalConnectionState) => void;
}

function clampDimension(value: number, min: number, max: number, fallback: number) {
  const next = Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, next));
}

export function TaskRunTerminalSession({
  baseUrl,
  terminalId,
  isActive,
  onConnectionStateChange,
}: TaskRunTerminalSessionProps) {
  const callbackRef = useRef<TaskRunTerminalSessionProps["onConnectionStateChange"]>(
    onConnectionStateChange
  );
  useEffect(() => {
    callbackRef.current = onConnectionStateChange;
  }, [onConnectionStateChange]);

  const [connectionState, setConnectionState] = useState<TerminalConnectionState>(
    "connecting"
  );

  const {
    ref: containerRef,
    instance: terminal,
  } = useXTerm();

  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminal) {
      return;
    }

    const nextScrollback = isActive
      ? ACTIVE_TERMINAL_SCROLLBACK
      : INACTIVE_TERMINAL_SCROLLBACK;

    if (terminal.options.scrollback !== nextScrollback) {
      terminal.options.scrollback = nextScrollback;
    }

    if (!isActive) {
      terminal.clear();
    }
  }, [isActive, terminal]);

  useEffect(() => {
    if (!terminal) {
      fitAddonRef.current = null;
      return;
    }

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();
    const unicodeAddon = new Unicode11Addon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(unicodeAddon);

    fitAddonRef.current = fitAddon;

    return () => {
      fitAddon.dispose();
      webLinksAddon.dispose();
      searchAddon.dispose();
      unicodeAddon.dispose();
      fitAddonRef.current = null;
    };
  }, [terminal]);

  useEffect(() => {
    if (!terminal || !isActive) {
      return;
    }

    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
    } catch (error) {
      console.warn("[TaskRunTerminalSession] WebGL addon unavailable", error);
      if (webglAddon) {
        webglAddon.dispose();
        webglAddon = null;
      }
    }

    return () => {
      if (webglAddon) {
        webglAddon.dispose();
      }
    };
  }, [isActive, terminal]);

  const socketRef = useRef<WebSocket | null>(null);
  const pendingResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const lastSentResizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const notifyConnectionState = useCallback((next: TerminalConnectionState) => {
    setConnectionState(next);
    callbackRef.current?.(next);
  }, []);

  const queueResize = useCallback(() => {
    if (!terminal) {
      pendingResizeRef.current = null;
      return;
    }

    const cols = clampDimension(terminal.cols, MIN_COLS, MAX_COLS, 80);
    const rows = clampDimension(terminal.rows, MIN_ROWS, MAX_ROWS, 24);
    const current = { cols, rows };

    const last = lastSentResizeRef.current;
    if (last && last.cols === current.cols && last.rows === current.rows) {
      pendingResizeRef.current = null;
      return;
    }

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "resize", cols: current.cols, rows: current.rows }));
      lastSentResizeRef.current = current;
      pendingResizeRef.current = null;
    } else {
      pendingResizeRef.current = current;
    }
  }, [terminal]);

  const measureAndQueueResize = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }
    fitAddon.fit();
    queueResize();
  }, [queueResize, terminal]);

  const flushPendingResize = useCallback(() => {
    if (!pendingResizeRef.current) {
      return;
    }
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const next = pendingResizeRef.current;
      pendingResizeRef.current = null;
      if (next) {
        socket.send(JSON.stringify({ type: "resize", cols: next.cols, rows: next.rows }));
        lastSentResizeRef.current = next;
      }
    }
  }, []);

  useEffect(() => {
    if (!terminal || !isActive) {
      return;
    }

    const disposable = terminal.onResize(() => {
      queueResize();
    });

    return () => {
      disposable.dispose();
    };
  }, [isActive, queueResize, terminal]);

  // Observe container resizes and propagate them to the backend
  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    let frame = 0;
    const handle = () => {
      frame = window.requestAnimationFrame(() => {
        measureAndQueueResize();
      });
    };

    const observer = new ResizeObserver(handle);
    observer.observe(container);
    window.addEventListener("resize", handle);

    // Initial fit and resize message
    measureAndQueueResize();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handle);
      window.cancelAnimationFrame(frame);
    };
  }, [containerRef, isActive, measureAndQueueResize]);

  // Manage WebSocket lifecycle
  useEffect(() => {
    if (!terminal) {
      notifyConnectionState("connecting");
      return undefined;
    }

    if (!isActive) {
      notifyConnectionState("closed");
      return undefined;
    }

    let cancelled = false;
    const base = new URL(baseUrl);
    const wsUrl = new URL(`/sessions/${terminalId}/ws`, base);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

    terminal.clear();
    pendingResizeRef.current = null;
    lastSentResizeRef.current = null;

    const socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    notifyConnectionState("connecting");

    const handleOpen = () => {
      if (cancelled) {
        return;
      }
      notifyConnectionState("open");
      // Ensure terminal dimensions are synchronised once the socket is ready
      measureAndQueueResize();
      flushPendingResize();
    };

    const handleClose = () => {
      if (cancelled) {
        return;
      }
      notifyConnectionState("closed");
    };

    const handleError = () => {
      if (cancelled) {
        return;
      }
      notifyConnectionState("error");
    };

    const handleMessage = async (event: MessageEvent) => {
      if (cancelled || !terminal) {
        return;
      }
      const text = await decodeWsMessage(event.data);
      if (!text) {
        return;
      }
      const control = parseControlMessage(text);
      if (control) {
        if (control.type === "exit") {
          socket.close();
          notifyConnectionState("closed");
          return;
        }
        if (control.type === "error") {
          console.error("[TaskRunTerminalSession] PTY error", control);
          return;
        }
        if (control.type === "output" && control.data) {
          terminal.write(control.data);
        }
        return;
      }
      terminal.write(text);
    };

    const inputDisposable = terminal.onData((data) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(JSON.stringify({ type: "input", data }));
    });

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);
    socket.addEventListener("message", handleMessage);

    return () => {
      cancelled = true;
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("message", handleMessage);
      inputDisposable.dispose();

      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }

      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [
    baseUrl,
    flushPendingResize,
    isActive,
    measureAndQueueResize,
    notifyConnectionState,
    terminal,
    terminalId,
  ]);

  useEffect(() => {
    if (!terminal) {
      return;
    }

    if (isActive) {
      measureAndQueueResize();
      // Defer focus to avoid triggering terminal queries during panel transitions
      // Use double RAF to ensure resize operations are fully complete
      // This prevents special characters from appearing when panels are swapped
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (terminal && isActive) {
            terminal.focus();
          }
        });
      });
    }
  }, [isActive, measureAndQueueResize, terminal]);

  const statusMessage = useMemo(() => {
    switch (connectionState) {
      case "open":
        return null;
      case "error":
        return "Failed to connect to the terminal backend.";
      case "closed":
        return "Terminal connection closed.";
      case "connecting":
      default:
        return "Connecting to terminal…";
    }
  }, [connectionState]);

  return (
    <div
      className={clsx("relative w-full h-full", { hidden: !isActive })}
      role="tabpanel"
      aria-hidden={!isActive}
      data-terminal-id={terminalId}
    >
      <div ref={containerRef} className="absolute inset-0" />
      {statusMessage ? (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/60 pointer-events-none">
          <span className="text-sm text-neutral-200 dark:text-neutral-300">
            {statusMessage}
          </span>
        </div>
      ) : null}
    </div>
  );
}
