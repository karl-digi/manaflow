import { AttachAddon } from "@xterm/addon-attach";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useXTerm } from "./xterm/use-xterm";

interface PreviewTerminalProps {
  terminalUrl: string;
  sessionId?: string;
  onError?: (error: string) => void;
  onConnectionStatusChange?: (connected: boolean) => void;
}

export function PreviewTerminal({
  terminalUrl,
  sessionId,
  onError,
  onConnectionStatusChange,
}: PreviewTerminalProps) {
  const fitAddon = useMemo(() => new FitAddon(), []);
  const webLinksAddon = useMemo(() => new WebLinksAddon(), []);
  const addons = useMemo(
    () => [fitAddon, webLinksAddon],
    [fitAddon, webLinksAddon],
  );

  const { ref: terminalRef, instance: terminal } = useXTerm({
    addons,
    options: {
      cursorBlink: true,
      scrollback: 8000,
    },
  });

  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const attachAddonRef = useRef<AttachAddon | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!terminal) return;

    const handleResize = () => {
      if (fitAddon && terminal) {
        fitAddon.fit();
      }
    };

    fitAddon.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [terminal, fitAddon]);

  useEffect(() => {
    if (!terminal || !terminalUrl) return;

    const connectWebSocket = () => {
      if (!mountedRef.current) return;

      try {
        // Build WebSocket URL
        const wsUrl = new URL(terminalUrl);
        wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

        // If sessionId is provided, append it to the path
        if (sessionId) {
          wsUrl.pathname = `/ws/${sessionId}`;
        } else {
          // Assume the terminalUrl already has the correct path
          // or use default dev window
          wsUrl.pathname = "/ws/dev";
        }

        const socket = new WebSocket(wsUrl.toString());
        socket.binaryType = "arraybuffer";
        socketRef.current = socket;

        const attachAddon = new AttachAddon(socket, { bidirectional: true });
        attachAddonRef.current = attachAddon;
        terminal.loadAddon(attachAddon);

        socket.addEventListener("open", () => {
          if (!mountedRef.current) return;
          setIsConnected(true);
          onConnectionStatusChange?.(true);
          terminal.focus();
          fitAddon.fit();

          // Send resize on connection
          setTimeout(() => {
            if (socket.readyState === WebSocket.OPEN && terminal) {
              const cols = terminal.cols;
              const rows = terminal.rows;
              try {
                socket.send(
                  JSON.stringify({ type: "resize", cols, rows }),
                );
              } catch (error) {
                console.warn("Failed to send resize message", error);
              }
            }
          }, 100);
        });

        socket.addEventListener("close", () => {
          if (!mountedRef.current) return;
          setIsConnected(false);
          onConnectionStatusChange?.(false);
          attachAddonRef.current?.dispose();
          attachAddonRef.current = null;
          socketRef.current = null;

          // Attempt to reconnect after 2 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connectWebSocket();
            }
          }, 2000);
        });

        socket.addEventListener("error", (event) => {
          if (!mountedRef.current) return;
          console.error("WebSocket error:", event);
          onError?.("Connection error");
        });
      } catch (error) {
        console.error("Failed to create WebSocket:", error);
        onError?.(
          error instanceof Error ? error.message : "Failed to connect",
        );
      }
    };

    connectWebSocket();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      attachAddonRef.current?.dispose();
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [
    terminal,
    terminalUrl,
    sessionId,
    fitAddon,
    onError,
    onConnectionStatusChange,
  ]);

  // Handle terminal resize when visible
  useEffect(() => {
    if (!terminal || !isConnected) return;

    const observer = new ResizeObserver(() => {
      if (fitAddon && terminal && terminalRef.current) {
        fitAddon.fit();
        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          const cols = terminal.cols;
          const rows = terminal.rows;
          try {
            socket.send(JSON.stringify({ type: "resize", cols, rows }));
          } catch (error) {
            console.warn("Failed to send resize message", error);
          }
        }
      }
    });

    if (terminalRef.current) {
      observer.observe(terminalRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [terminal, fitAddon, terminalRef, isConnected]);

  return (
    <div className="relative h-full w-full bg-[#1e1e1e]">
      <div ref={terminalRef} className="h-full w-full" />
      {!isConnected && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e]/80 backdrop-blur-sm">
          <div className="text-center">
            <div className="mb-2 inline-block size-6 animate-spin rounded-full border-2 border-neutral-500 border-t-neutral-200" />
            <p className="text-sm text-neutral-400">Connecting to terminal...</p>
          </div>
        </div>
      )}
    </div>
  );
}
