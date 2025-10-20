import { createTerminalOptions } from "@cmux/shared/terminal-config";
import { AttachAddon } from "@xterm/addon-attach";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";

interface TerminalSessionProps extends HTMLAttributes<HTMLDivElement> {
  backendBaseUrl: string;
  terminalId: string;
  isActive: boolean;
}

type ConnectionState = "connecting" | "open" | "closed" | "error";

function normalizeDimensions(cols: number, rows: number) {
  const safeCols = Number.isFinite(cols) && cols > 0 ? cols : 80;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 24;
  return {
    cols: Math.max(20, Math.min(320, Math.round(safeCols))),
    rows: Math.max(8, Math.min(120, Math.round(safeRows))),
  };
}

export function TerminalSession({
  backendBaseUrl,
  className,
  isActive,
  terminalId,
  ...props
}: TerminalSessionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const attachAddonRef = useRef<AttachAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    "connecting"
  );

  const performResize = useCallback(() => {
    const term = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;

    fitAddon.fit();
    const { cols, rows } = normalizeDimensions(term.cols, term.rows);
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "resize",
          cols,
          rows,
        })
      );
    }
  }, []);

  const backendWsUrl = useMemo(() => {
    const url = new URL(`/ws/${terminalId}`, backendBaseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }, [backendBaseUrl, terminalId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const terminal = new Terminal(
      createTerminalOptions({
        cursorBlink: true,
        scrollback: 1_000_000,
      })
    );
    terminalRef.current = terminal;

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();
    const unicodeAddon = new Unicode11Addon();

    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(unicodeAddon);
    unicodeAddon.activate(terminal);

    let webglAddon: WebglAddon | null = null;
    try {
      webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
      webglAddonRef.current = webglAddon;
    } catch (error) {
      console.debug("[TerminalSession] WebGL addon unavailable", error);
    }

    terminal.open(container);

    const handleWindowResize = () => {
      window.requestAnimationFrame(performResize);
    };

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(performResize);
    });
    resizeObserver.observe(container);
    resizeObserverRef.current = resizeObserver;

    window.addEventListener("resize", handleWindowResize);

    const socket = new WebSocket(backendWsUrl);
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    const attachAddon = new AttachAddon(socket, { bidirectional: true });
    attachAddonRef.current = attachAddon;
    terminal.loadAddon(attachAddon);

    const handleOpen = () => {
      setConnectionState("open");
      performResize();
      window.setTimeout(performResize, 100);
    };

    const handleClose = () => {
      setConnectionState("closed");
    };

    const handleError = (event: Event) => {
      console.error("[TerminalSession] socket error", event);
      setConnectionState("error");
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);

    return () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleError);

      resizeObserver.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      resizeObserverRef.current = null;

      attachAddon.dispose();
      attachAddonRef.current = null;

      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      socketRef.current = null;

      if (webglAddon) {
        try {
          webglAddon.dispose();
        } catch (error) {
          console.debug("[TerminalSession] failed to dispose webgl addon", error);
        }
      }
      webglAddonRef.current = null;

      fitAddonRef.current = null;
      terminalRef.current = null;

      terminal.dispose();
    };
  }, [backendWsUrl, performResize]);

  useEffect(() => {
    if (!isActive) return;
    const terminal = terminalRef.current;
    if (!terminal) return;

    window.requestAnimationFrame(() => {
      performResize();
      terminal.focus();
    });
  }, [isActive, performResize]);

  return (
    <div className={clsx("flex flex-col min-h-0", className)} {...props}>
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300">
        <span className="truncate">Terminal {terminalId}</span>
        <span className="ml-auto text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          {connectionState}
        </span>
      </div>
      <div
        ref={containerRef}
        className="grow min-h-0 bg-neutral-950"
        aria-label={`Terminal session ${terminalId}`}
      />
    </div>
  );
}
