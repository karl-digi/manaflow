import { ElectronPreviewBrowser } from "@/components/electron-preview-browser";
import {
  TaskRunTerminalSession,
  type TerminalConnectionState,
} from "@/components/task-run-terminal-session";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getTaskRunPreviewPersistKey } from "@/lib/persistent-webview-keys";
import { toMorphXtermBaseUrl } from "@/lib/toProxyWorkspaceUrl";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Terminal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createTerminalTab,
  deleteTerminalTab,
  terminalTabsQueryKey,
  terminalTabsQueryOptions,
  type TerminalTabId,
} from "@/queries/terminals";
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
  const queryClient = useQueryClient();

  // Terminal visibility state
  const [isTerminalVisible, setIsTerminalVisible] = useState(false);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [terminalConnectionState, setTerminalConnectionState] = useState<TerminalConnectionState>("connecting");
  const hasAutoExpandedRef = useRef(false);

  const taskRuns = useQuery(api.taskRuns.getByTask, {
    teamSlugOrId,
    taskId,
  });

  // Get the specific run
  const selectedRun = useMemo(() => {
    return taskRuns?.find((run) => run._id === runId);
  }, [runId, taskRuns]);

  // Get terminal base URL
  const terminalBaseUrl = useMemo(() => {
    const vscodeInfo = selectedRun?.vscode;
    const rawMorphUrl = vscodeInfo?.url ?? vscodeInfo?.workspaceUrl ?? null;
    const isMorphProvider = vscodeInfo?.provider === "morph";

    if (!isMorphProvider || !rawMorphUrl) {
      return null;
    }

    return toMorphXtermBaseUrl(rawMorphUrl);
  }, [selectedRun]);

  // Find the service URL for the requested port
  const previewUrl = useMemo(() => {
    if (!selectedRun?.networking) return null;
    const portNum = parseInt(port, 10);
    const service = selectedRun.networking.find(
      (s) => s.port === portNum && s.status === "running",
    );
    return service?.url;
  }, [selectedRun, port]);

  const persistKey = useMemo(() => {
    return getTaskRunPreviewPersistKey(runId, port);
  }, [runId, port]);

  // Create terminal tab when terminal becomes visible or on mount
  useEffect(() => {
    if (!terminalBaseUrl || terminalId) return;

    // Auto-create terminal tab
    const createTab = async () => {
      try {
        const created = await createTerminalTab({
          baseUrl: terminalBaseUrl,
          request: {
            cmd: "tmux",
            args: ["attach", "-t", "cmux"],
          },
        });

        setTerminalId(created.id);

        // Update query cache
        const tabsQueryKey = terminalTabsQueryKey(terminalBaseUrl, runId);
        queryClient.setQueryData<TerminalTabId[]>(tabsQueryKey, (current) => {
          if (!current || current.length === 0) {
            return [created.id];
          }
          if (current.includes(created.id)) {
            return current;
          }
          return [...current, created.id];
        });
      } catch (error) {
        console.error("Failed to create terminal tab", error);
      }
    };

    createTab();
  }, [terminalBaseUrl, terminalId, queryClient, runId]);

  // Monitor terminal output for errors (using WebSocket to detect error patterns)
  useEffect(() => {
    if (!terminalBaseUrl || !terminalId || hasAutoExpandedRef.current) return;

    // Create WebSocket connection to monitor terminal output
    const base = new URL(terminalBaseUrl);
    const wsUrl = new URL(`/ws/${terminalId}`, base);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

    const socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";

    let errorDetectionTimeout: ReturnType<typeof setTimeout> | null = null;
    let recentOutput = "";

    const checkForErrors = () => {
      // Check for common error patterns in terminal output
      const errorPatterns = [
        /error:/i,
        /failed/i,
        /exception/i,
        /traceback/i,
        /cannot find module/i,
        /modulenotfounderror/i,
        /syntaxerror/i,
        /typeerror/i,
        /referenceerror/i,
        /econnrefused/i,
        /eaddrinuse/i,
        /npm err!/i,
        /yarn error/i,
        /fatal:/i,
        /panic:/i,
      ];

      const hasError = errorPatterns.some(pattern => pattern.test(recentOutput));

      if (hasError && !hasAutoExpandedRef.current) {
        setIsTerminalVisible(true);
        hasAutoExpandedRef.current = true;
      }

      recentOutput = ""; // Clear buffer after checking
    };

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const decoder = new TextDecoder();
        const text = decoder.decode(event.data);
        recentOutput += text;

        // Debounce error checking
        if (errorDetectionTimeout) {
          clearTimeout(errorDetectionTimeout);
        }
        errorDetectionTimeout = setTimeout(checkForErrors, 500);
      }
    };

    // Clean up after 30 seconds to avoid keeping the monitoring connection open too long
    const cleanupTimeout = setTimeout(() => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }, 30000);

    return () => {
      if (errorDetectionTimeout) {
        clearTimeout(errorDetectionTimeout);
      }
      clearTimeout(cleanupTimeout);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };
  }, [terminalBaseUrl, terminalId]);

  // Handle terminal connection state changes
  const handleTerminalConnectionStateChange = useCallback((state: TerminalConnectionState) => {
    setTerminalConnectionState(state);

    // Auto-expand terminal on connection error (only once per session)
    if (state === "error" && !hasAutoExpandedRef.current) {
      setIsTerminalVisible(true);
      hasAutoExpandedRef.current = true;
    }
  }, []);

  // Toggle terminal visibility
  const toggleTerminal = useCallback(() => {
    setIsTerminalVisible((prev) => !prev);
  }, []);

  // Cleanup terminal tab on unmount
  useEffect(() => {
    return () => {
      if (terminalId && terminalBaseUrl) {
        deleteTerminalTab({
          baseUrl: terminalBaseUrl,
          tabId: terminalId,
        }).catch((error) => {
          console.error("Failed to delete terminal tab on unmount", error);
        });
      }
    };
  }, [terminalId, terminalBaseUrl]);

  const paneBorderRadius = 6;

  return (
    <div className="flex h-full flex-col bg-white dark:bg-neutral-950">
      {/* Header bar with terminal toggle */}
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-100/70 px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Preview
          </span>
          {previewUrl && (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              Port {port}
            </span>
          )}
        </div>

        {terminalBaseUrl && terminalId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "size-7 rounded-md p-0 text-neutral-600 hover:text-neutral-800",
                  "dark:text-neutral-500 dark:hover:text-neutral-100",
                  isTerminalVisible && "bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                )}
                onClick={toggleTerminal}
                aria-label={isTerminalVisible ? "Hide terminal" : "Show terminal"}
              >
                {isTerminalVisible ? (
                  <X className="size-4" />
                ) : (
                  <Terminal className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isTerminalVisible ? "Hide terminal" : "Show dev terminal"}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        {/* Preview area */}
        <div className={cn(
          "flex-1 min-h-0 transition-all duration-200",
          isTerminalVisible && "flex-[2]"
        )}>
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

        {/* Terminal panel */}
        {isTerminalVisible && terminalBaseUrl && terminalId && (
          <div className="flex-1 border-l border-neutral-200 bg-[#1e1e1e] dark:border-neutral-800 min-w-[300px]">
            <TaskRunTerminalSession
              baseUrl={terminalBaseUrl}
              terminalId={terminalId}
              isActive={true}
              onConnectionStateChange={handleTerminalConnectionStateChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}
