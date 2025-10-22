import { ElectronPreviewBrowser } from "@/components/electron-preview-browser";
import { getTaskRunPreviewPersistKey } from "@/lib/persistent-webview-keys";
import {
  TaskRunTerminalSession,
  type TerminalConnectionState,
} from "@/components/task-run-terminal-session";
import { toMorphXtermBaseUrl } from "@/lib/toProxyWorkspaceUrl";
import {
  createTerminalTab,
  deleteTerminalTab,
  type CreateTerminalTabResponse,
} from "@/queries/terminals";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo, useState, useCallback, useRef } from "react";
import { Terminal, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalConnectionState, setTerminalConnectionState] =
    useState<TerminalConnectionState>("connecting");
  const terminalIdRef = useRef<string | null>(null);
  const hasErrorRef = useRef(false);

  const taskRuns = useQuery(api.taskRuns.getByTask, {
    teamSlugOrId,
    taskId,
  });

  // Get the specific run
  const selectedRun = useMemo(() => {
    return taskRuns?.find((run) => run._id === runId);
  }, [runId, taskRuns]);

  // Get the Morph workspace URL for terminals
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

  // Create terminal ID for dev window
  const terminalId = useMemo(() => {
    if (!terminalBaseUrl) return null;
    // Create a stable terminal session that attaches to the dev window
    const id = `dev-terminal-${runId}-${port}`;
    terminalIdRef.current = id;
    return id;
  }, [terminalBaseUrl, runId, port]);

  const handleToggleTerminal = useCallback(() => {
    setShowTerminal((prev) => !prev);
  }, []);

  const handleOpenInBrowser = useCallback(() => {
    if (previewUrl) {
      window.open(previewUrl, "_blank", "noopener,noreferrer");
    }
  }, [previewUrl]);

  const handleConnectionStateChange = useCallback((state: TerminalConnectionState) => {
    setTerminalConnectionState(state);

    // Auto-expand terminal on error if not already showing
    if (state === "error" && !hasErrorRef.current && !showTerminal) {
      hasErrorRef.current = true;
      setShowTerminal(true);
    }
  }, [showTerminal]);

  const paneBorderRadius = 6;

  return (
    <div className="flex h-full flex-col bg-white dark:bg-neutral-950">
      {/* Top bar with controls */}
      <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-600 dark:text-neutral-400">
            Preview: Port {port}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {previewUrl && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenInBrowser}
                    className="gap-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                    <span>Open in Browser</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Open preview in a new browser tab
                </TooltipContent>
              </Tooltip>

              {terminalBaseUrl && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={showTerminal ? "secondary" : "ghost"}
                      size="sm"
                      onClick={handleToggleTerminal}
                      className={cn(
                        "gap-2",
                        terminalConnectionState === "error" && "text-red-600 dark:text-red-400"
                      )}
                    >
                      <Terminal className="h-4 w-4" />
                      <span>{showTerminal ? "Hide" : "Show"} Terminal</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {showTerminal ? "Hide" : "Show"} the dev server terminal
                  </TooltipContent>
                </Tooltip>
              )}
            </>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 min-h-0 flex">
        {/* Preview area */}
        <div className={cn(
          "flex-1 min-w-0",
          showTerminal && "transition-all duration-300"
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

        {/* Terminal sidebar */}
        {showTerminal && terminalBaseUrl && terminalId && (
          <div className="w-[500px] border-l border-neutral-200 dark:border-neutral-800 bg-black flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
              <span className="text-xs text-neutral-400">Dev Server Terminal</span>
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-2 h-2 rounded-full",
                    CONNECTION_STATE_COLORS[terminalConnectionState]
                  )}
                  title={`Connection: ${terminalConnectionState}`}
                />
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <DevTerminalSession
                baseUrl={terminalBaseUrl}
                _runId={runId}
                isActive={true}
                onConnectionStateChange={handleConnectionStateChange}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Terminal connection state indicator colors
const CONNECTION_STATE_COLORS: Record<TerminalConnectionState, string> = {
  open: "bg-emerald-500",
  connecting: "bg-amber-500",
  closed: "bg-neutral-400 dark:bg-neutral-600",
  error: "bg-red-500",
};

// Custom component for dev terminal that connects to the dev tmux window
function DevTerminalSession({
  baseUrl,
  _runId, // Passed for context but not used in current implementation
  isActive,
  onConnectionStateChange,
}: {
  baseUrl: string;
  _runId: string;
  isActive: boolean;
  onConnectionStateChange?: (state: TerminalConnectionState) => void;
}) {
  void _runId; // Mark as intentionally unused
  const [terminalData, setTerminalData] = useState<CreateTerminalTabResponse | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const createdRef = useRef(false);
  const terminalIdRef = useRef<string | null>(null);

  // Create terminal session using a stable reference pattern
  const createTerminalIfNeeded = useCallback(() => {
    if (createdRef.current || isCreating) {
      return;
    }

    createdRef.current = true;
    setIsCreating(true);

    const createTerminal = async () => {
      try {
        // Create a terminal that attaches to the dev tmux window
        const result = await createTerminalTab({
          baseUrl,
          request: {
            cmd: "tmux",
            args: ["attach-session", "-t", "cmux:dev"],
          },
        });

        terminalIdRef.current = result.id;
        setTerminalData(result);
      } catch (error) {
        console.error("Failed to create dev terminal:", error);
        onConnectionStateChange?.("error");
      } finally {
        setIsCreating(false);
      }
    };

    createTerminal();
  }, [baseUrl, isCreating, onConnectionStateChange]);

  // Call the creation function
  createTerminalIfNeeded();

  // Cleanup on unmount using a ref-based pattern
  const cleanupRef = useRef<(() => void) | null>(null);
  if (!cleanupRef.current && terminalIdRef.current) {
    const tabId = terminalIdRef.current;
    cleanupRef.current = () => {
      deleteTerminalTab({ baseUrl, tabId }).catch((error) => {
        console.error("Failed to delete terminal:", error);
      });
    };
  }

  // Register cleanup in a useMemo to avoid useEffect
  useMemo(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  if (!terminalData) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-neutral-400">Connecting to terminal...</span>
      </div>
    );
  }

  return (
    <TaskRunTerminalSession
      baseUrl={baseUrl}
      terminalId={terminalData.id}
      isActive={isActive}
      onConnectionStateChange={onConnectionStateChange}
    />
  );
}
