import {
  VncViewer,
  type VncConnectionStatus,
  type VncViewerHandle,
} from "@cmux/shared/components/vnc-viewer";
import { WorkspaceLoadingIndicator } from "@/components/workspace-loading-indicator";
import { toGenericVncWebsocketUrl } from "@/lib/toProxyWorkspaceUrl";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import z from "zod";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import { useQuery } from "convex/react";
import { addBrowserReloadListener } from "@/lib/browser-reload-events";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
});

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/browser"
)({
  component: BrowserComponent,
  params: {
    parse: paramsSchema.parse,
    stringify: (params) => ({
      taskId: params.taskId,
      runId: params.runId,
    }),
  },
  loader: async (opts) => {
    convexQueryClient.convexClient.prewarmQuery({
      query: api.taskRuns.get,
      args: { teamSlugOrId: opts.params.teamSlugOrId, id: opts.params.runId },
    });
  },
});

/**
 * Convert a VNC base URL to a websocket URL for noVNC connection.
 * Supports both HTTP and HTTPS base URLs.
 */
function toVncWebsocketUrl(vncBaseUrl: string): string {
  try {
    const url = new URL(vncBaseUrl);
    // Convert protocol: https -> wss, http -> ws
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/websockify";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return vncBaseUrl;
  }
}

function BrowserComponent() {
  const { runId: taskRunId, teamSlugOrId } = Route.useParams();
  const vncRef = useRef<VncViewerHandle>(null);
  const taskRun = useQuery(api.taskRuns.get, {
    teamSlugOrId,
    id: taskRunId,
  });

  const vscodeInfo = taskRun?.vscode ?? null;
  const rawMorphUrl = vscodeInfo?.url ?? vscodeInfo?.workspaceUrl ?? null;

  // Prefer vncUrl from task run data (works for all providers including PVE LXC)
  // Fall back to deriving from Morph URL for backward compatibility
  const vncWebsocketUrl = useMemo(() => {
    // If we have a direct vncUrl from the task run, use it
    if (vscodeInfo?.vncUrl) {
      return toVncWebsocketUrl(vscodeInfo.vncUrl);
    }
    // Fall back to URL derivation for backward compatibility (works for both Morph and PVE LXC)
    if (rawMorphUrl) {
      return toGenericVncWebsocketUrl(rawMorphUrl);
    }
    return null;
  }, [vscodeInfo?.vncUrl, rawMorphUrl]);

  const hasBrowserView = Boolean(vncWebsocketUrl);
  const isSupportedProvider = vscodeInfo?.provider === "morph" || vscodeInfo?.provider === "pve-lxc";
  const showLoader = isSupportedProvider && !hasBrowserView;

  const [vncStatus, setVncStatus] = useState<VncConnectionStatus>("disconnected");

  const overlayMessage = useMemo(() => {
    if (!isSupportedProvider) {
      return "Browser preview is not available for this sandbox provider.";
    }
    if (!hasBrowserView) {
      return "Waiting for the workspace to expose a browser preview...";
    }
    return "Launching browser preview...";
  }, [hasBrowserView, isSupportedProvider]);

  const onConnect = useCallback(() => {
    console.log(`Browser VNC connected for task run ${taskRunId}`);
  }, [taskRunId]);

  const onDisconnect = useCallback(
    (_rfb: unknown, detail: { clean: boolean }) => {
      console.log(
        `Browser VNC disconnected for task run ${taskRunId} (clean: ${detail.clean})`
      );
    },
    [taskRunId]
  );

  useEffect(() => {
    return addBrowserReloadListener((runId) => {
      if (runId !== taskRunId) return;
      const viewer = vncRef.current;
      if (!viewer) return;
      viewer.disconnect();
      viewer.connect();
    });
  }, [taskRunId]);

  const loadingFallback = useMemo(
    () => <WorkspaceLoadingIndicator variant="browser" status="loading" />,
    []
  );
  const errorFallback = useMemo(
    () => <WorkspaceLoadingIndicator variant="browser" status="error" />,
    []
  );

  const isBrowserBusy = !hasBrowserView || vncStatus !== "connected";

  return (
    <div className="flex flex-col grow bg-neutral-50 dark:bg-black">
      <div className="flex flex-col grow min-h-0 border-l border-neutral-200 dark:border-neutral-800">
        <div
          className="flex flex-row grow min-h-0 relative"
          aria-busy={isBrowserBusy}
        >
          {vncWebsocketUrl ? (
            <VncViewer
              ref={vncRef}
              url={vncWebsocketUrl}
              className="grow"
              background="#000000"
              scaleViewport
              autoConnect
              focusOnClick
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onStatusChange={setVncStatus}
              loadingFallback={loadingFallback}
              errorFallback={errorFallback}
            />
          ) : (
            <div className="grow" />
          )}
          <div
            className={clsx(
              "absolute inset-0 flex items-center justify-center transition pointer-events-none",
              {
                "opacity-100": !hasBrowserView,
                "opacity-0": hasBrowserView,
              }
            )}
          >
            {showLoader ? (
              <WorkspaceLoadingIndicator variant="browser" status="loading" />
            ) : (
              <span className="text-sm text-neutral-500 dark:text-neutral-400 text-center px-4">
                {overlayMessage}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
