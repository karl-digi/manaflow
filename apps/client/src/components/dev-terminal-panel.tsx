import { Terminal, X } from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useXTerm } from "./xterm/use-xterm";

interface DevTerminalToggleButtonProps {
  isOpen: boolean;
  onToggle: (open: boolean) => void;
}

interface DevTerminalContentProps {
  isOpen: boolean;
  onToggle: (open: boolean) => void;
}

export function DevTerminalToggleButton({
  isOpen,
  onToggle,
}: DevTerminalToggleButtonProps) {
  const terminalTooltipLabel = isOpen ? "Hide Terminal" : "Show Terminal";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-full p-0 text-neutral-600 hover:text-neutral-800 disabled:opacity-30 disabled:hover:text-neutral-400 dark:text-neutral-500 dark:hover:text-neutral-100 dark:disabled:hover:text-neutral-500"
          onClick={() => onToggle(!isOpen)}
          aria-label={terminalTooltipLabel}
        >
          <Terminal className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{terminalTooltipLabel}</TooltipContent>
    </Tooltip>
  );
}

export function DevTerminalContent({
  isOpen,
  onToggle,
}: DevTerminalContentProps) {
  const fitAddon = useMemo(() => new FitAddon(), []);
  const webLinksAddon = useMemo(() => new WebLinksAddon(), []);
  const addons = useMemo(
    () => [fitAddon, webLinksAddon],
    [fitAddon, webLinksAddon]
  );

  const { ref: terminalRef, instance: terminal } = useXTerm({
    addons,
  });

  // Auto-fit terminal when panel opens/closes or terminal mounts
  const handleResize = useCallback(() => {
    if (fitAddon && isOpen) {
      try {
        fitAddon.fit();
      } catch (error) {
        console.warn("Failed to fit terminal", error);
      }
    }
  }, [fitAddon, isOpen]);

  // Handle window resize
  React.useEffect(() => {
    if (!terminal) return;

    // Initial fit
    handleResize();

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [terminal, fitAddon, handleResize]);

  // Focus terminal and fit when panel opens
  React.useEffect(() => {
    if (isOpen && terminal && fitAddon) {
      try {
        handleResize();
        terminal.focus();
      } catch (error) {
        console.warn("Failed to focus or fit terminal", error);
      }
    }
  }, [isOpen, terminal, fitAddon, handleResize]);

  // Cleanup terminal on unmount
  React.useEffect(() => {
    return () => {
      terminal?.dispose();
    };
  }, [terminal]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="flex flex-col h-full bg-neutral-950 border-t border-neutral-800 overflow-hidden">
      {/* Terminal header with close button */}
      <div className="flex items-center justify-between px-3 py-2 bg-neutral-900 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <Terminal className="size-4 text-neutral-500" />
          <span className="text-xs font-medium text-neutral-400">
            Dev Terminal
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5 rounded p-0 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
              onClick={() => onToggle(false)}
              aria-label="Close terminal"
            >
              <X className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Close</TooltipContent>
        </Tooltip>
      </div>

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden">
        <div
          ref={terminalRef}
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: "#1e1e1e",
          }}
        />
      </div>
    </div>
  );
}

export function DevTerminalPanel({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: (open: boolean) => void;
}) {
  return (
    <>
      <DevTerminalToggleButton isOpen={isOpen} onToggle={onToggle} />
      <DevTerminalContent isOpen={isOpen} onToggle={onToggle} />
    </>
  );
}
