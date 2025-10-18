import { ElectronPreviewBrowser } from "@/components/electron-preview-browser";
import { PreviewTerminal } from "@/components/preview/PreviewTerminal";
import { getTaskRunPreviewPersistKey } from "@/lib/persistent-webview-keys";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
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

  const persistKey = useMemo(() => {
    return getTaskRunPreviewPersistKey(runId, port);
  }, [runId, port]);
  const workspaceSourceUrl = useMemo(() => {
    return selectedRun?.vscode?.workspaceUrl ?? selectedRun?.vscode?.url ?? null;
  }, [selectedRun]);

  const devError = selectedRun?.environmentError?.devError ?? null;
  const [showTerminal, setShowTerminal] = useState(() => Boolean(devError));
  const lastDevErrorRef = useRef<string | null>(devError ?? null);

  useEffect(() => {
    if (devError && devError !== lastDevErrorRef.current) {
      setShowTerminal(true);
      lastDevErrorRef.current = devError;
    } else if (!devError) {
      lastDevErrorRef.current = null;
    }
  }, [devError]);

  const handleToggleTerminal = () => {
    setShowTerminal((prev) => !prev);
  };

  const previewLinkClasses = clsx(
    "inline-flex items-center justify-center gap-1 rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium transition-colors",
    "text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900",
    previewUrl ? undefined : "cursor-not-allowed opacity-60 hover:bg-transparent dark:hover:bg-neutral-900"
  );

  const toggleButtonClasses = clsx(
    "inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
    showTerminal
      ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
      : "border-neutral-200 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
  );

  const previewCardClasses = clsx(
    "flex-1 min-h-0 min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-none",
    showTerminal ? "lg:basis-2/3" : "lg:basis-full"
  );

  const terminalContainerClasses = clsx(
    "rounded-lg border border-neutral-200 bg-neutral-950 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none lg:flex-shrink-0 lg:basis-[420px]",
    showTerminal ? "flex h-[320px] flex-col overflow-hidden lg:h-auto" : "hidden"
  );

  return (
    <div className="flex h-full flex-col bg-white dark:bg-neutral-950">
      <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/60">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
              Preview (port {port})
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Inspect the live dev server and keep the dev script terminal handy.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              className={previewLinkClasses}
              href={previewUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (!previewUrl) {
                  event.preventDefault();
                }
              }}
            >
              Open in browser
            </a>
            <button type="button" className={toggleButtonClasses} onClick={handleToggleTerminal}>
              {showTerminal ? "Hide terminal" : "Show terminal"}
            </button>
          </div>
        </div>
      </div>
      {devError ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
          {devError}
        </div>
      ) : null}
      <div className="flex flex-1 flex-col gap-4 overflow-hidden px-4 py-4 lg:flex-row">
        <div className={previewCardClasses}>
          <div className="h-full w-full">
            {previewUrl ? (
              <ElectronPreviewBrowser persistKey={persistKey} src={previewUrl} />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center">
                <div>
                  <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
                    {selectedRun
                      ? `Port ${port} is not available for this run.`
                      : "Loading preview details..."}
                  </p>
                  {selectedRun?.networking && selectedRun.networking.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-xs text-neutral-400 dark:text-neutral-500">
                        Available ports:
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {selectedRun.networking
                          .filter((s) => s.status === "running")
                          .map((service) => (
                            <span
                              key={service.port}
                              className="rounded-md border border-neutral-200 bg-neutral-100 px-2 py-1 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
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
        </div>
        <div className={terminalContainerClasses}>
          <PreviewTerminal baseUrl={workspaceSourceUrl} isVisible={showTerminal} />
        </div>
      </div>
    </div>
  );
}
