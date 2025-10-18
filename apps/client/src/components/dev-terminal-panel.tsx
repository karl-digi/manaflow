import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { AttachAddon } from "@xterm/addon-attach";
import type { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { Button } from "@/components/ui/button";
import { useXTerm } from "@/components/xterm/use-xterm";
import { cn } from "@/lib/utils";

const DEFAULT_ATTACH_TARGET = "cmux:dev";
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;

type ConnectionState =
  | "idle"
  | "starting"
  | "connecting"
  | "connected"
  | "disconnected"
  | "closing"
  | "error";

type DevTerminalPanelProps = {
  /** Base HTTP URL for the cmux-xterm service (e.g. https://host:39383). */
  baseUrl: string | null;
  /** tmux target to attach to, defaults to cmux:dev. */
  attachTarget?: string;
  /** Optional classNames for the root panel container. */
  className?: string;
};

type StatusMeta = {
  label: string;
  colorClass: string;
  pulse?: boolean;
};

const STATUS_META: Record<ConnectionState, StatusMeta> = {
  idle: { label: "Idle", colorClass: "bg-neutral-400" },
  starting: { label: "Starting", colorClass: "bg-amber-500", pulse: true },
  connecting: { label: "Connecting", colorClass: "bg-amber-500", pulse: true },
  connected: { label: "Connected", colorClass: "bg-emerald-500" },
  disconnected: { label: "Disconnected", colorClass: "bg-neutral-500" },
  closing: { label: "Closing", colorClass: "bg-neutral-400", pulse: true },
  error: { label: "Error", colorClass: "bg-red-500" },
};

function normalizeBaseUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url;
  } catch {
    try {
      // Attempt to prepend https:// if scheme missing
      return new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }
}

export function DevTerminalPanel({
  baseUrl,
  attachTarget = DEFAULT_ATTACH_TARGET,
  className,
}: DevTerminalPanelProps) {
  const normalizedBase = useMemo(() => normalizeBaseUrl(baseUrl), [baseUrl]);
  const httpOrigin = useMemo(() => {
    if (!normalizedBase) return null;
    return `${normalizedBase.protocol}//${normalizedBase.host}`;
  }, [normalizedBase]);
  const wsOrigin = useMemo(() => {
    if (!normalizedBase) return null;
    const protocol = normalizedBase.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${normalizedBase.host}`;
  }, [normalizedBase]);

  const fitAddon = useMemo(() => new FitAddon(), []);
  const webLinksAddon = useMemo(() => new WebLinksAddon(), []);

  const { ref: terminalRef, instance: terminal } = useXTerm({
    addons: [fitAddon, webLinksAddon],
    options: {
      convertEol: true,
      scrollback: 100_000,
      fontFamily:
        "'JetBrains Mono', 'SFMono-Regular', ui-monospace, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      theme: {
        background: "#0b1120",
        foreground: "#e2e8f0",
        cursor: "#38bdf8",
        selection: "#1e293b",
      },
    },
  });

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionOriginRef = useRef<string | null>(null);
  const attachAddonRef = useRef<AttachAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const clearSocketListeners = useCallback((socket: WebSocket | null) => {
    if (!socket) return;
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
  }, []);

  const disposeSession = useCallback(async () => {
    setConnectionState((prev) =>
      prev === "connected" || prev === "connecting" ? "closing" : prev,
    );
    const socket = socketRef.current;
    clearSocketListeners(socket);
    if (attachAddonRef.current) {
      attachAddonRef.current.dispose();
      attachAddonRef.current = null;
    }
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      try {
        socket.close();
      } catch {
        // ignore close errors
      }
    }
    socketRef.current = null;

    const sessionId = sessionIdRef.current;
    const base = sessionOriginRef.current;
    sessionIdRef.current = null;
    sessionOriginRef.current = null;

    if (sessionId && base) {
      try {
        await fetch(`${base}/api/tabs/${sessionId}`, {
          method: "DELETE",
          mode: "cors",
        });
      } catch {
        // Deletion best effort
      }
    }

    setConnectionState((prev) => (prev === "closing" ? "idle" : prev));
  }, [clearSocketListeners]);

  const sendResize = useCallback(
    (term: Terminal | null) => {
      if (!term) return;
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          }),
        );
      } catch (error) {
        console.warn("Failed to send resize message", error);
      }
    },
    [],
  );

  const fitAndResize = useCallback(
    (term: Terminal | null) => {
      if (!term) return;
      try {
        fitAddon.fit();
        sendResize(term);
      } catch (error) {
        console.warn("Failed to fit terminal", error);
      }
    },
    [fitAddon, sendResize],
  );

  const connect = useCallback(async () => {
    if (!normalizedBase || !httpOrigin || !wsOrigin || !terminal) {
      setConnectionState("error");
      setErrorMessage(
        "Terminal endpoint is unavailable. Preview must expose the cmux-xterm service.",
      );
      return;
    }

    await disposeSession();

    setConnectionState("starting");
    setErrorMessage(null);

    try {
      const response = await fetch(`${httpOrigin}/api/tabs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        mode: "cors",
        body: JSON.stringify({
          cmd: "tmux",
          args: ["attach", "-t", attachTarget],
          cols: DEFAULT_COLS,
          rows: DEFAULT_ROWS,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          text && text.length > 0
            ? text
            : `Terminal request failed (${response.status})`,
        );
      }

      const payload = (await response.json()) as {
        id: string;
        ws_url?: string;
      };

      sessionIdRef.current = payload.id;
      sessionOriginRef.current = httpOrigin;

      const wsUrl = payload.ws_url
        ? `${wsOrigin}${payload.ws_url}`
        : `${wsOrigin}/ws/${payload.id}`;

      const socket = new WebSocket(wsUrl);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      const attachAddon = new AttachAddon(socket, { bidirectional: true });
      attachAddonRef.current = attachAddon;
      terminal.loadAddon(attachAddon);

      setConnectionState("connecting");

      socket.onopen = () => {
        setConnectionState("connected");
        setErrorMessage(null);
        requestAnimationFrame(() => {
          fitAndResize(terminal);
        });
      };

      socket.onclose = () => {
        setConnectionState((prev) =>
          prev === "closing" ? "idle" : "disconnected",
        );
      };

      socket.onerror = () => {
        setConnectionState("error");
        setErrorMessage("Unable to connect to the dev terminal.");
      };
    } catch (error) {
      console.error("Failed to start dev terminal session", error);
      setConnectionState("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Unknown terminal error",
      );
      await disposeSession();
    }
  }, [
    normalizedBase,
    httpOrigin,
    wsOrigin,
    terminal,
    disposeSession,
    attachTarget,
    fitAndResize,
  ]);

  useEffect(() => {
    if (!terminal) return;
    fitAndResize(terminal);
    terminal.focus();
  }, [terminal, fitAndResize]);

  useEffect(() => {
    if (!terminalRef.current) return;
    const resizeObserver = new ResizeObserver(() => {
      fitAndResize(terminal);
    });
    const element = terminalRef.current;
    resizeObserver.observe(element);
    resizeObserverRef.current = resizeObserver;
    return () => {
      resizeObserver.disconnect();
      resizeObserverRef.current = null;
    };
  }, [terminal, fitAndResize, terminalRef]);

  useEffect(() => {
    const handleWindowResize = () => {
      fitAndResize(terminal);
    };
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [terminal, fitAndResize]);

  useEffect(() => {
    if (!baseUrl) {
      setConnectionState("error");
      setErrorMessage("Terminal endpoint not provided for this preview.");
      return;
    }
    if (!terminal) return;
    void connect();
    return () => {
      void disposeSession();
    };
  }, [baseUrl, terminal, connect, disposeSession]);

  const statusMeta = STATUS_META[connectionState];

  const showReconnect =
    connectionState === "error" || connectionState === "disconnected";
  const reconnectDisabled = connectionState === "starting";

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Dev Script Terminal
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            tmux target <code className="font-mono text-[11px]">{attachTarget}</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
            <span
              className={cn(
                "inline-flex h-2.5 w-2.5 rounded-full",
                statusMeta.colorClass,
                statusMeta.pulse ? "animate-pulse" : undefined,
              )}
            />
            {statusMeta.label}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void connect();
            }}
            disabled={reconnectDisabled || connectionState === "connecting"}
            className="h-7 text-xs"
          >
            {showReconnect ? "Reconnect" : "Reload"}
          </Button>
        </div>
      </div>
      <div className="relative flex-1 bg-[#0b1120]">
        <div
          ref={terminalRef}
          className="h-full w-full"
          style={{
            backgroundColor: "#0b1120",
          }}
        />
        {connectionState === "starting" ||
        connectionState === "connecting" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0b1120]/80">
            <p className="text-xs uppercase tracking-[0.2em] text-neutral-400">
              Connecting terminal…
            </p>
          </div>
        ) : null}
      </div>
      <div className="border-t border-neutral-200 px-4 py-2 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        <p>
          Use <code className="font-mono text-[11px]">tmux attach -t {attachTarget}</code> inside the
          worker shell to inspect the same output directly.
        </p>
        {errorMessage ? (
          <p className="mt-2 text-[11px] text-red-500 dark:text-red-400">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
