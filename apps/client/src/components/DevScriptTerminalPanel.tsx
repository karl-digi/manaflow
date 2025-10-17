import { useEffect, useMemo, useRef } from "react";

import { createTerminalOptions } from "@cmux/shared/terminal-config";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ITerminalOptions } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { useXTerm } from "@/components/xterm/use-xterm";
import { cn } from "@/lib/utils";

interface DevScriptTerminalPanelProps {
  className?: string;
  devError?: string | null;
  maintenanceError?: string | null;
  runLabel?: string;
  status?: "idle" | "running" | "error";
}

export function DevScriptTerminalPanel({
  className,
  devError,
  maintenanceError,
  runLabel,
  status = "idle",
}: DevScriptTerminalPanelProps) {
  const fitAddon = useMemo(() => new FitAddon(), []);
  const webLinksAddon = useMemo(() => new WebLinksAddon(), []);

  const terminalOptions: ITerminalOptions = useMemo(() => {
    return createTerminalOptions({
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      allowProposedApi: true,
      cursorBlink: true,
      theme: {
        background: "#0f172a",
        foreground: "#e2e8f0",
        cursor: "#38bdf8",
        selectionForeground: "#0f172a",
        selectionBackground: "rgba(56, 189, 248, 0.4)",
      },
    });
  }, []);

  const addons = useMemo(() => [fitAddon, webLinksAddon], [fitAddon, webLinksAddon]);

  const { ref: terminalRef, instance: terminal } = useXTerm({
    addons,
    options: terminalOptions,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Keep terminal fitted to available space
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore fit errors triggered during layout transitions
      }
    });
    observer.observe(containerRef.current);

    const handleWindowResize = () => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    };

    window.addEventListener("resize", handleWindowResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [fitAddon]);

  // Populate terminal content based on status/errors
  useEffect(() => {
    if (!terminal) return;

    const writeLines = (lines: string[], options?: { padBottom?: boolean }) => {
      lines.forEach((line) => terminal.writeln(line));
      if (options?.padBottom) {
        terminal.writeln("");
      }
    };

    terminal.reset();

    const banner = runLabel ? `Dev script · ${runLabel}` : "Dev script terminal";
    terminal.writeln("\u001b[38;2;148;163;184m───────────────────────────────\u001b[0m");
    terminal.writeln(`\u001b[38;2;148;163;184m${banner}\u001b[0m`);
    terminal.writeln("\u001b[38;2;148;163;184m───────────────────────────────\u001b[0m");
    terminal.writeln("");

    if (status === "error" && devError) {
      writeLines([
        "\u001b[38;2;248;113;113mDev script encountered an error.\u001b[0m",
        "",
      ]);
      writeLines(devError.split(/\r?\n/));
    } else if (status === "error" && maintenanceError) {
      writeLines([
        "\u001b[38;2;248;113;113mMaintenance script encountered an error.\u001b[0m",
        "",
      ]);
      writeLines(maintenanceError.split(/\r?\n/));
    } else if (status === "running") {
      writeLines([
        "\u001b[38;2;56;189;248mDev script running. Waiting for output…\u001b[0m",
        "",
        "Logs will appear here when available.",
      ]);
    } else {
      writeLines([
        "\u001b[38;2;148;163;184mDev script output not available yet.\u001b[0m",
        "",
        "Start the dev server or check back once the environment is ready.",
      ]);
    }

    terminal.scrollToTop();
    try {
      fitAddon.fit();
    } catch {
      // ignore
    }
  }, [devError, maintenanceError, runLabel, status, terminal, fitAddon]);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "error":
        return { text: "Error", tone: "error" as const };
      case "running":
        return { text: "Running", tone: "running" as const };
      default:
        return { text: "Idle", tone: "idle" as const };
    }
  }, [status]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg border border-neutral-800/60 bg-[#0a101f] shadow-xl",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-neutral-800/60 px-3 py-2">
        <div className="space-y-0.5 text-xs">
          <div className="font-medium text-neutral-200">Dev script terminal</div>
          {runLabel ? (
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">
              {runLabel}
            </div>
          ) : null}
        </div>
        <div
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
            statusLabel.tone === "error" && "bg-red-500/10 text-red-300",
            statusLabel.tone === "running" && "bg-cyan-500/10 text-cyan-300",
            statusLabel.tone === "idle" && "bg-neutral-700/60 text-neutral-300",
          )}
        >
          {statusLabel.text}
        </div>
      </div>
      <div className="relative flex-1 bg-[#0f172a]">
        <div
          ref={terminalRef}
          className="absolute inset-0"
          aria-label="Dev script terminal output"
        />
      </div>
    </div>
  );
}

