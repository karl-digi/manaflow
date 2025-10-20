import { ElectronPreviewBrowser } from "@/components/electron-preview-browser";
import { PreviewTerminal } from "@/components/preview-terminal";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getTaskRunPreviewPersistKey } from "@/lib/persistent-webview-keys";
import { cn } from "@/lib/utils";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Terminal } from "lucide-react";
import { useMemo, useState } from "react";
import z from "zod";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
  port: z.string(),
});

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/preview/$port",
)({
  component: PreviewPage,
  params: {
    parse: paramsSchema.parse,
    stringify: (params) => {
      return {
        taskId: params.taskId,
        runId: params.runId,
        port: params.port,
      };
    },
  },
});

function PreviewPage() {
  const { taskId, teamSlugOrId, runId, port } = Route.useParams();
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [hasTerminalError, setHasTerminalError] = useState(false);

  const taskRuns = useQuery(api.taskRuns.getByTask, {
    teamSlugOrId,
    taskId,
  });

  // Get the specific run
  const selectedRun = useMemo(() => {
    return taskRuns?.find((run) => run._id === runId);
  }, [runId, taskRuns]);

  // Find the service URL for the requested port
  const previewUrl = useMemo(() => {
    if (!selectedRun?.networking) return null;
    const portNum = parseInt(port, 10);
    const service = selectedRun.networking.find(
      (s) => s.port === portNum && s.status === "running",
    );
    return service?.url;
  }, [selectedRun, port]);

  // Find the terminal URL (typically on a fixed port like 9999)
  const terminalUrl = useMemo(() => {
    if (!selectedRun?.networking) return null;
    // Look for terminal service - could be labeled or on a known port
    const terminalService = selectedRun.networking.find(
      (s) =>
        s.status === "running" &&
        (s.port === 9999 || s.url.includes("xterm") || s.url.includes("terminal")),
    );
    return terminalService?.url;
  }, [selectedRun]);

  const persistKey = useMemo(() => {
    return getTaskRunPreviewPersistKey(runId, port);
  }, [runId, port]);

  const paneBorderRadius = 6;

  // Auto-expand terminal on error
  const handleTerminalError = (error: string) => {
    console.error("Terminal error:", error);
    setHasTerminalError(true);
    if (!isTerminalOpen) {
      setIsTerminalOpen(true);
    }
  };

  return (
    <div className="flex h-full flex-col bg-white dark:bg-neutral-950">
      {/* Top bar with terminal toggle */}
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "gap-2 text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100",
                isTerminalOpen && "bg-neutral-100 dark:bg-neutral-800",
                hasTerminalError &&
                  !isTerminalOpen &&
                  "text-orange-600 dark:text-orange-400",
              )}
              onClick={() => setIsTerminalOpen(!isTerminalOpen)}
              disabled={!terminalUrl}
            >
              <Terminal className="size-4" />
              <span className="text-xs font-medium">Terminal</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {terminalUrl
              ? isTerminalOpen
                ? "Hide terminal"
                : "Show terminal"
              : "Terminal not available"}
          </TooltipContent>
        </Tooltip>
        {hasTerminalError && !isTerminalOpen && (
          <span className="text-xs text-orange-600 dark:text-orange-400">
            Terminal connection error
          </span>
        )}
      </div>

      {/* Main content area with preview and optional terminal */}
      <div className="flex flex-1 min-h-0">
        {/* Preview area */}
        <div
          className={cn(
            "flex-1 min-h-0 transition-all duration-300",
            isTerminalOpen && "pr-0",
          )}
        >
          {previewUrl ? (
            <ElectronPreviewBrowser
              persistKey={persistKey}
              src={previewUrl}
              borderRadius={paneBorderRadius}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
                  {selectedRun
                    ? `Port ${port} is not available for this run`
                    : "Loading..."}
                </p>
                {selectedRun?.networking && selectedRun.networking.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
                      Available ports:
                    </p>
                    <div className="flex justify-center gap-2">
                      {selectedRun.networking
                        .filter((s) => s.status === "running")
                        .map((service) => (
                          <span
                            key={service.port}
                            className="rounded px-2 py-1 text-xs bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
                          >
                            {service.port}
                          </span>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Terminal panel - slides in from the right */}
        {isTerminalOpen && terminalUrl && (
          <div className="flex w-[500px] flex-col border-l border-neutral-200 dark:border-neutral-800">
            <PreviewTerminal
              terminalUrl={terminalUrl}
              sessionId="dev"
              onError={handleTerminalError}
              onConnectionStatusChange={(connected) => {
                if (connected) {
                  setHasTerminalError(false);
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
