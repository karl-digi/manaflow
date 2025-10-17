import { DevScriptTerminalPanel } from "@/components/DevScriptTerminalPanel";
import { ElectronPreviewBrowser } from "@/components/electron-preview-browser";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getTaskRunPreviewPersistKey } from "@/lib/persistent-webview-keys";
import { cn } from "@/lib/utils";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import z from "zod";

type EnvironmentError =
  | {
      devError?: string;
      maintenanceError?: string;
    }
  | undefined
  | null;

type TerminalStatus = "error" | "running" | "idle";

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
    stringify: (params) => ({
      taskId: params.taskId,
      runId: params.runId,
      port: params.port,
    }),
  },
});

function PreviewPage() {
  const { taskId, teamSlugOrId, runId, port } = Route.useParams();

  const taskRuns = useQuery(api.taskRuns.getByTask, {
    teamSlugOrId,
    taskId,
  });

  const selectedRun = useMemo(() => {
    return taskRuns?.find((run) => run._id === runId);
  }, [runId, taskRuns]);

  const previewUrl = useMemo(() => {
    if (!selectedRun?.networking) return null;
    const portNum = Number.parseInt(port, 10);
    const service = selectedRun.networking.find(
      (s) => s.port === portNum && s.status === "running",
    );
    return service?.url ?? null;
  }, [selectedRun, port]);

  const persistKey = useMemo(() => {
    return getTaskRunPreviewPersistKey(runId, port);
  }, [runId, port]);

  const paneBorderRadius = 6;

  const environmentError: EnvironmentError = selectedRun?.environmentError;
  const devError = environmentError?.devError ?? null;
  const maintenanceError = environmentError?.maintenanceError ?? null;
  const hasScriptError = Boolean(devError || maintenanceError);

  const [showTerminal, setShowTerminal] = useState(false);

  useEffect(() => {
    if (hasScriptError) {
      setShowTerminal(true);
    }
  }, [hasScriptError]);

  const handleToggleTerminal = () => {
    setShowTerminal((previous) => !previous);
  };

  const availablePorts = useMemo(() => {
    if (!selectedRun?.networking) return [] as number[];
    return selectedRun.networking
      .filter((service) => service.status === "running")
      .map((service) => service.port);
  }, [selectedRun?.networking]);

  const terminalStatus: TerminalStatus = hasScriptError
    ? "error"
    : selectedRun?.status === "running"
      ? "running"
      : "idle";

  const runLabel = useMemo(() => {
    if (!selectedRun) return undefined;
    if (selectedRun.agentName && selectedRun.agentName.trim().length > 0) {
      return selectedRun.agentName;
    }
    if (selectedRun.summary && selectedRun.summary.trim().length > 0) {
      return selectedRun.summary;
    }
    return undefined;
  }, [selectedRun]);

  return (
    <div className="flex h-full flex-col bg-white dark:bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
            Preview · port {port}
          </span>
          {selectedRun?.newBranch ? (
            <span className="text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {selectedRun.newBranch}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            asChild
            size="sm"
            variant="outline"
            disabled={!previewUrl}
            className="min-w-[140px]"
          >
            <a href={previewUrl ?? undefined} target="_blank" rel="noreferrer">
              Open in browser
            </a>
          </Button>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={showTerminal ? "default" : "outline"}
                onClick={handleToggleTerminal}
                className="flex items-center gap-1"
              >
                <TerminalSquare className="h-4 w-4" />
                {showTerminal ? "Hide terminal" : "Show terminal"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end">
              View the dev script terminal
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 transition-[gap,padding] lg:flex-row",
          showTerminal ? "lg:gap-6 lg:px-6 lg:py-6" : undefined,
        )}
      >
        <div
          className={cn(
            "flex flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950",
            showTerminal ? "lg:basis-2/3" : "lg:basis-full",
          )}
        >
          <div className="flex-1 min-h-0">
            {previewUrl ? (
              <ElectronPreviewBrowser
                persistKey={persistKey}
                src={previewUrl}
                borderRadius={paneBorderRadius}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 py-10 text-center">
                <div>
                  <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
                    {selectedRun
                      ? `Port ${port} is not available for this run`
                      : "Loading..."}
                  </p>
                  {availablePorts.length > 0 ? (
                    <div className="mt-4">
                      <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
                        Available ports:
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {availablePorts.map((servicePort) => (
                          <span
                            key={servicePort}
                            className="rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-200"
                          >
                            {servicePort}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        {showTerminal ? (
          <div className="flex flex-1 flex-col gap-4 lg:w-[360px] lg:flex-none">
            <DevScriptTerminalPanel
              className="h-full"
              devError={devError}
              maintenanceError={maintenanceError}
              runLabel={runLabel}
              status={terminalStatus}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
