import { useXTerm } from "@/components/xterm/use-xterm";
import { extractMorphInstanceInfo } from "@cmux/shared/utils/morph-instance";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { AttachAddon } from "@xterm/addon-attach";
import type { ITerminalAddon } from "@xterm/xterm";
import { Terminal as XTerm } from "@xterm/xterm";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";

const DEFAULT_ATTACH_COMMAND =
  "tmux attach-session -t cmux:dev || tmux attach-session -t cmux";

type TerminalStatus =
  | "idle"
  | "initializing"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

interface PreviewTerminalProps {
  baseUrl: string | null;
  isVisible: boolean;
  attachCommand?: string;
  className?: string;
}

interface NormalizedDimensions {
  cols: number;
  rows: number;
}

function normalizeDimensions(cols: number, rows: number): NormalizedDimensions {
  const safeCols = Number.isFinite(cols) && cols > 0 ? cols : 80;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 24;
  return {
    cols: Math.max(20, Math.min(320, Math.round(safeCols))),
    rows: Math.max(8, Math.min(120, Math.round(safeRows))),
  };
}

function deriveTerminalBaseUrl(source: string | null | undefined): string | null {
  if (!source) {
    return null;
  }

  try {
    const base = new URL(source);
    const info = extractMorphInstanceInfo(base);
    if (!info) {
      return null;
    }

    const terminalUrl = new URL(base.toString());
    switch (info.source) {
      case "http-cloud":
        terminalUrl.hostname = `port-39383-morphvm-${info.morphId}.http.cloud.morph.so`;
        break;
      case "cmux-proxy":
        terminalUrl.hostname = `cmux-${info.morphId}-base-39383.cmux.app`;
        break;
      case "cmux-port":
        terminalUrl.hostname = `port-39383-${info.morphId}.cmux.app`;
        break;
      default:
        return null;
    }

    terminalUrl.port = "";
    terminalUrl.pathname = "/";
    terminalUrl.search = "";
    terminalUrl.hash = "";
    return terminalUrl.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function buildEndpoint(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? `${baseUrl}` : `${baseUrl}/`).toString();
}

export function PreviewTerminal({
  baseUrl,
  isVisible,
  attachCommand = DEFAULT_ATTACH_COMMAND,
  className,
}: PreviewTerminalProps) {
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const fitAddon = useMemo(() => new FitAddon(), []);
  const webLinksAddon = useMemo(() => new WebLinksAddon(), []);
  const searchAddon = useMemo(() => new SearchAddon(), []);
  const unicodeAddon = useMemo(() => new Unicode11Addon(), []);

  const staticAddons = useMemo(() => {
    return [fitAddon, webLinksAddon, searchAddon, unicodeAddon] as ITerminalAddon[];
  }, [fitAddon, searchAddon, unicodeAddon, webLinksAddon]);

  const { ref: terminalRef, instance: terminal } = useXTerm({
    addons: staticAddons,
  });

  const resolvedBaseUrl = useMemo(
    () => deriveTerminalBaseUrl(baseUrl),
    [baseUrl]
  );

  const socketRef = useRef<WebSocket | null>(null);
  const attachAddonRef = useRef<AttachAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionBaseRef = useRef<string | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const pendingAttachTimeoutRef = useRef<number | null>(null);
  const lastSentSizeRef = useRef<NormalizedDimensions | null>(null);
  const socketReadyRef = useRef(false);
  const hasSentAttachRef = useRef(false);

  const cleanupSocket = useCallback(() => {
    if (pendingAttachTimeoutRef.current !== null) {
      window.clearTimeout(pendingAttachTimeoutRef.current);
      pendingAttachTimeoutRef.current = null;
    }

    attachAddonRef.current?.dispose();
    attachAddonRef.current = null;

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
    socketRef.current = null;
    socketReadyRef.current = false;
    hasSentAttachRef.current = false;
  }, []);

  const deleteSession = useCallback(async () => {
    const base = sessionBaseRef.current;
    const sessionId = sessionIdRef.current;
    if (!base || !sessionId) {
      return;
    }

    try {
      const endpoint = buildEndpoint(base, `/api/tabs/${sessionId}`);
      await fetch(endpoint, { method: "DELETE" });
    } catch {
      // Swallow cleanup errors.
    }
  }, []);

  const teardownSession = useCallback(async () => {
    cleanupSocket();
    await deleteSession();
    sessionIdRef.current = null;
    sessionBaseRef.current = null;
  }, [cleanupSocket, deleteSession]);

  const sendResize = useCallback(
    (size: NormalizedDimensions) => {
      if (!socketReadyRef.current || !socketRef.current) {
        return;
      }
      const last = lastSentSizeRef.current;
      if (last && last.cols === size.cols && last.rows === size.rows) {
        return;
      }
      try {
        socketRef.current.send(
          JSON.stringify({ type: "resize", cols: size.cols, rows: size.rows })
        );
        lastSentSizeRef.current = size;
      } catch {
        // Ignore send failures; socket close handler will update state.
      }
    },
    []
  );

  const fitAndResize = useCallback(() => {
    if (!terminal) {
      return;
    }
    fitAddon.fit();
    const size = normalizeDimensions(terminal.cols, terminal.rows);
    sendResize(size);
  }, [fitAddon, sendResize, terminal]);

  useEffect(() => {
    if (!terminal) {
      return;
    }
    unicodeAddon.activate(terminal);
  }, [terminal, unicodeAddon]);

  useEffect(() => {
    const element = terminalRef.current;
    if (!terminal || !element) {
      return;
    }

    fitAndResize();

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        fitAndResize();
      });
    });
    observer.observe(element);
    resizeObserverRef.current = observer;

    const handleWindowResize = () => {
      window.requestAnimationFrame(() => {
        fitAndResize();
      });
    };
    window.addEventListener("resize", handleWindowResize);

    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [fitAndResize, terminal, terminalRef]);

  useEffect(() => {
    if (!isVisible) {
      void teardownSession();
      if (status !== "idle") {
        setStatus("idle");
      }
      return;
    }

    if (!terminal || !resolvedBaseUrl) {
      return;
    }

    if (sessionBaseRef.current === resolvedBaseUrl && sessionIdRef.current) {
      return;
    }

    let cancelled = false;

    const createSession = async () => {
      await teardownSession();
      setStatus("initializing");
      setError(null);

      try {
        fitAddon.fit();
        const initialSize = normalizeDimensions(terminal.cols, terminal.rows);
        const endpoint = buildEndpoint(resolvedBaseUrl, "/api/tabs");
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cols: initialSize.cols, rows: initialSize.rows }),
        });

        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }

        const payload = (await response.json()) as { id: string; ws_url?: string };
        if (cancelled) {
          return;
        }

        sessionIdRef.current = payload.id;
        sessionBaseRef.current = resolvedBaseUrl;
        lastSentSizeRef.current = initialSize;

        const wsUrl = new URL(`/ws/${payload.id}`, resolvedBaseUrl);
        wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

        const socket = new WebSocket(wsUrl);
        socket.binaryType = "arraybuffer";
        socketRef.current = socket;
        setStatus("connecting");

        const attachAddon = new AttachAddon(socket, { bidirectional: true });
        attachAddonRef.current = attachAddon;
        terminal.loadAddon(attachAddon);

        socket.addEventListener("open", () => {
          if (cancelled) {
            return;
          }
          socketReadyRef.current = true;
          setStatus("connected");
          fitAndResize();

          if (!hasSentAttachRef.current) {
            pendingAttachTimeoutRef.current = window.setTimeout(() => {
              if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
                return;
              }
              try {
                socketRef.current.send(`${attachCommand}\r`);
                hasSentAttachRef.current = true;
              } catch {
                // Ignore send errors.
              }
            }, 150);
          }
        });

        socket.addEventListener("close", () => {
          socketReadyRef.current = false;
          if (cancelled) {
            return;
          }
          setStatus((prev) => (prev === "error" ? prev : "disconnected"));
        });

        socket.addEventListener("error", (event) => {
          console.error("Preview terminal websocket error", event);
          socketReadyRef.current = false;
          if (cancelled) {
            return;
          }
          setStatus("error");
          setError("Failed to connect to terminal session.");
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Preview terminal setup failed", err);
        if (cancelled) {
          return;
        }
        await teardownSession();
        setStatus("error");
        setError(message);
      }
    };

    void createSession();

    return () => {
      cancelled = true;
      void teardownSession();
    };
  }, [attachCommand, fitAddon, isVisible, resolvedBaseUrl, status, teardownSession, terminal]);

  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      void teardownSession();
    };
  }, [teardownSession]);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "idle":
        return "Idle";
      case "initializing":
        return "Preparing session";
      case "connecting":
        return "Connecting";
      case "connected":
        return "Connected";
      case "disconnected":
        return "Disconnected";
      case "error":
        return "Error";
      default:
        return "";
    }
  }, [status]);

  const showOverlay = status === "initializing" || status === "connecting";

  return (
    <div className={clsx("flex h-full flex-col", className)}>
      <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300">
        <span className="font-medium uppercase tracking-wide">Dev Terminal</span>
        <span
          className={clsx("flex items-center gap-1", {
            "text-green-600 dark:text-green-400": status === "connected",
            "text-amber-600 dark:text-amber-400": status === "disconnected",
            "text-red-600 dark:text-red-400": status === "error",
          })}
        >
          {statusLabel}
          {showOverlay ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : null}
        </span>
      </div>

      {!resolvedBaseUrl ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
          Terminal service is not available for this environment.
        </div>
      ) : (
        <div className="relative flex-1 bg-neutral-950">
          <div ref={terminalRef} className="h-full w-full" />
          {showOverlay ? (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/70">
              <div className="flex flex-col items-center gap-2 text-neutral-200">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-xs">Connecting to dev session…</span>
              </div>
            </div>
          ) : null}
          {status === "error" && error ? (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/80 px-4">
              <div className="flex max-w-sm flex-col items-center gap-2 text-center text-sm text-red-200">
                <AlertTriangle className="h-5 w-5" />
                <span>{error}</span>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function usePreviewTerminalBaseUrl(
  vscodeUrl: string | null | undefined,
): string | null {
  return useMemo(() => deriveTerminalBaseUrl(vscodeUrl), [vscodeUrl]);
}
