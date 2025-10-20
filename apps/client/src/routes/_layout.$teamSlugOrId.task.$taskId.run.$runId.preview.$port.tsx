import { ElectronPreviewBrowser } from "@/components/electron-preview-browser";
import { DevTerminalPanel } from "@/components/dev-terminal-panel";
import { Button } from "@/components/ui/button";
import { getTaskRunPreviewPersistKey } from "@/lib/persistent-webview-keys";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, SquareTerminal } from "lucide-react";
import { useQuery } from "convex/react";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import z from "zod";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
  port: z.string(),
});

const DEV_TERMINAL_PORT = 39383;

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

  const [isTerminalOpen, setIsTerminalOpen] = useState(false);

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

  const runningServices = useMemo(() => {
    return selectedRun?.networking?.filter((service) => service.status === "running") ?? [];
  }, [selectedRun]);

  const terminalBaseUrl = useMemo(() => {
    if (runningServices.length === 0) return null;
    const byPort = runningServices.find((service) => service.port === DEV_TERMINAL_PORT);
    if (byPort?.url) {
      return byPort.url.endsWith("/") ? byPort.url : `${byPort.url}/`;
    }
    const byName = runningServices.find((service) =>
      service.url.toLowerCase().includes("xterm") ||
      service.url.toLowerCase().includes("terminal"),
    );
    if (byName?.url) {
      return byName.url.endsWith("/") ? byName.url : `${byName.url}/`;
    }
    return null;
  }, [runningServices]);

  const hasDevError = Boolean(selectedRun?.environmentError?.devError);

  useEffect(() => {
    if (hasDevError) {
      setIsTerminalOpen(true);
    }
  }, [hasDevError]);

  const paneBorderRadius = 6;

  return (
    <div className="flex h-full flex-col bg-white dark:bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={isTerminalOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setIsTerminalOpen((prev) => !prev)}
          >
            <SquareTerminal className="h-4 w-4" />
            Terminal
          </Button>
          {previewUrl ? (
            <Button variant="ghost" size="sm" asChild>
              <a href={previewUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open in Browser
              </a>
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
          <span>Port {port}</span>
          {hasDevError ? (
            <span className="rounded bg-rose-100 px-2 py-0.5 font-medium text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
              Dev script error
            </span>
          ) : null}
        </div>
      </div>
      <div
        className={clsx(
          "grid flex-1 min-h-0 gap-3 px-4 py-3 transition-[grid-template-columns] duration-300 ease-in-out lg:gap-4",
          isTerminalOpen
            ? "grid-cols-[minmax(0,1fr)_minmax(320px,420px)]"
            : "grid-cols-1",
        )}
      >
        <div className="min-h-0 overflow-hidden rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          {previewUrl ? (
            <ElectronPreviewBrowser
              persistKey={persistKey}
              src={previewUrl}
              borderRadius={paneBorderRadius}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 py-8">
              <div className="text-center">
                <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
                  {selectedRun
                    ? `Port ${port} is not available for this run`
                    : "Loading..."}
                </p>
                {runningServices.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
                      Available ports:
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {runningServices.map((service) => (
                        <span
                          key={service.port}
                          className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
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
        <div
          className={clsx(
            "min-h-0 overflow-hidden",
            isTerminalOpen ? "block" : "hidden",
          )}
        >
          <DevTerminalPanel
            baseUrl={terminalBaseUrl}
            isOpen={isTerminalOpen}
            className="h-full"
          />
        </div>
      </div>
    </div>
  );
}
