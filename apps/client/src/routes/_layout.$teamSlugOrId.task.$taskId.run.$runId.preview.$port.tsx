import { ElectronPreviewBrowser } from "@/components/electron-preview-browser";
import { DevTerminalPanel } from "@/components/dev-terminal-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getTaskRunPreviewPersistKey } from "@/lib/persistent-webview-keys";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { ExternalLink, SquareTerminal } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import z from "zod";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
  port: z.string(),
});

const XTERM_PORT = 39383;

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

  const taskRuns = useQuery(api.taskRuns.getByTask, {
    teamSlugOrId,
    taskId,
  });

  const selectedRun = useMemo(() => {
    return taskRuns?.find((run) => run._id === runId);
  }, [runId, taskRuns]);

  const previewUrl = useMemo(() => {
    if (!selectedRun?.networking) return null;
    const portNum = parseInt(port, 10);
    const service = selectedRun.networking.find(
      (entry) => entry.port === portNum && entry.status === "running",
    );
    return service?.url ?? null;
  }, [selectedRun, port]);

  const previewHost = useMemo(() => {
    if (!previewUrl) return null;
    try {
      const url = new URL(previewUrl);
      return url.host;
    } catch {
      return previewUrl;
    }
  }, [previewUrl]);

  const persistKey = useMemo(() => {
    return getTaskRunPreviewPersistKey(runId, port);
  }, [runId, port]);

  const xtermBaseUrl = useMemo(() => {
    if (!selectedRun) return null;
    const direct = selectedRun.networking?.find(
      (entry) => entry.status === "running" && entry.port === XTERM_PORT,
    );
    if (direct?.url) {
      return direct.url;
    }
    const fallback = previewUrl ?? selectedRun.vscode?.url ?? null;
    if (!fallback) return null;
    try {
      const url = new URL(fallback);
      url.port = String(XTERM_PORT);
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }, [selectedRun, previewUrl]);

  const availablePorts = useMemo(() => {
    return (
      selectedRun?.networking?.filter((entry) => entry.status === "running") ??
      []
    );
  }, [selectedRun]);

  const devScriptError = selectedRun?.environmentError?.devError ?? null;

  const [showTerminal, setShowTerminal] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const errorLatchRef = useRef(false);

  const hasAnyError = Boolean(devScriptError) || previewError;

  useEffect(() => {
    if (hasAnyError && !errorLatchRef.current) {
      errorLatchRef.current = true;
      setShowTerminal(true);
    }
    if (!hasAnyError) {
      errorLatchRef.current = false;
    }
  }, [hasAnyError]);

  const toggleTerminal = useCallback(() => {
    setShowTerminal((previous) => !previous);
  }, []);

  const handlePreviewErrorChange = useCallback((isError: boolean) => {
    setPreviewError(isError);
  }, []);

  const terminalPanel = showTerminal ? (
    xtermBaseUrl ? (
      <DevTerminalPanel
        baseUrl={xtermBaseUrl}
        className="w-full shrink-0 lg:w-[420px] xl:w-[480px]"
      />
    ) : (
      <div className="flex w-full shrink-0 flex-col items-center justify-center border-l border-neutral-200 bg-white px-6 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400 lg:w-[420px] xl:w-[480px]">
        <p>Dev terminal is not exposed for this run.</p>
        <p className="mt-2 text-xs">
          Forward port {XTERM_PORT} in <code className="font-mono">devcontainer.json</code> to stream tmux output.
        </p>
      </div>
    )
  ) : null;

  return (
    <div className="flex h-full flex-col bg-white dark:bg-neutral-950">
      <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Preview · Port {port}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {previewHost
                ? previewHost
                : selectedRun
                  ? `Waiting for service to expose port ${port}`
                  : "Loading run details…"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              asChild
              size="sm"
              variant="outline"
              className="flex items-center gap-1 text-xs"
              disabled={!previewUrl}
            >
              <a
                href={previewUrl ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!previewUrl}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in browser
              </a>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={toggleTerminal}
              variant={showTerminal ? "secondary" : "outline"}
              className={cn(
                "flex items-center gap-1 text-xs",
                hasAnyError
                  ? "border-red-500 text-red-600 dark:border-red-500 dark:text-red-400"
                  : undefined,
              )}
            >
              <SquareTerminal className="h-3.5 w-3.5" />
              {showTerminal ? "Hide terminal" : "Show terminal"}
              {hasAnyError ? (
                <span className="ml-1 inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
              ) : null}
            </Button>
          </div>
        </div>
        {devScriptError ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
            {devScriptError}
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-h-0 min-w-0">
          {previewUrl ? (
            <ElectronPreviewBrowser
              persistKey={persistKey}
              src={previewUrl}
              onErrorPageChange={handlePreviewErrorChange}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6">
              <div className="text-center">
                <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
                  {selectedRun
                    ? `Port ${port} is not available for this run`
                    : "Loading preview…"}
                </p>
                {availablePorts.length > 0 ? (
                  <div className="mt-4">
                    <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
                      Available ports:
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {availablePorts.map((service) => (
                        <span
                          key={service.port}
                          className="rounded px-2 py-1 text-xs bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
                        >
                          {service.port}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
        {terminalPanel}
      </div>
    </div>
  );
}

