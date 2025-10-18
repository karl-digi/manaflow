import { ElectronPreviewBrowser } from "@/components/electron-preview-browser";
import {
  DevTerminalToggleButton,
  DevTerminalContent,
} from "@/components/dev-terminal-panel";
import { getTaskRunPreviewPersistKey } from "@/lib/persistent-webview-keys";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
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

  const paneBorderRadius = 6;

  return (
    <div className="flex h-full flex-col bg-white dark:bg-neutral-950">
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Preview area with terminal toggle button */}
        <div
          className="flex-1 min-h-0"
          style={{
            display: isTerminalOpen ? "flex" : "block",
            flexDirection: isTerminalOpen ? "column" : undefined,
          }}
        >
          {previewUrl ? (
            <div className="relative flex-1 min-h-0">
              <ElectronPreviewBrowser
                persistKey={persistKey}
                src={previewUrl}
                borderRadius={paneBorderRadius}
              />
              {/* Terminal toggle button positioned in the browser toolbar area */}
              <div className="absolute top-[50px] right-[50px] z-10">
                <DevTerminalToggleButton
                  isOpen={isTerminalOpen}
                  onToggle={setIsTerminalOpen}
                />
              </div>
            </div>
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

        {/* Terminal Panel - shown below preview when open */}
        {isTerminalOpen && (
          <div className="w-full h-64 flex flex-col border-t border-neutral-200 dark:border-neutral-800 flex-shrink-0">
            <DevTerminalContent
              isOpen={isTerminalOpen}
              onToggle={setIsTerminalOpen}
            />
          </div>
        )}
      </div>
    </div>
  );
}
