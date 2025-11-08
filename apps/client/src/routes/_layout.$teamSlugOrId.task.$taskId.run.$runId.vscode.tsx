import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import z from "zod";
import type { PersistentIframeStatus } from "@/components/persistent-iframe";
import { PersistentWebView } from "@/components/persistent-webview";
import { getTaskRunPersistKey } from "@/lib/persistent-webview-keys";
import { WorkspaceLoadingIndicator } from "@/components/workspace-loading-indicator";
import { toProxyWorkspaceUrl } from "@/lib/toProxyWorkspaceUrl";
import {
  preloadTaskRunIframes,
  TASK_RUN_IFRAME_ALLOW,
  TASK_RUN_IFRAME_SANDBOX,
} from "../lib/preloadTaskRunIframes";
import { shouldUseServerIframePreflight } from "@/hooks/useIframePreflight";
import {
  localVSCodeServeWebQueryOptions,
  useLocalVSCodeServeWebQuery,
} from "@/queries/local-vscode-serve-web";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
});

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/vscode"
)({
  component: VSCodeComponent,
  params: {
    parse: paramsSchema.parse,
    stringify: (params) => {
      return {
        taskId: params.taskId,
        runId: params.runId,
      };
    },
  },
  loader: async (opts) => {
    convexQueryClient.convexClient.prewarmQuery({
      query: api.taskRuns.get,
      args: { teamSlugOrId: opts.params.teamSlugOrId, id: opts.params.runId },
    });

    void (async () => {
      const [result, localServeWeb] = await Promise.all([
        opts.context.queryClient.ensureQueryData(
          convexQuery(api.taskRuns.get, {
            teamSlugOrId: opts.params.teamSlugOrId,
            id: opts.params.runId,
          })
        ),
        opts.context.queryClient.ensureQueryData(
          localVSCodeServeWebQueryOptions()
        ),
      ]);
      if (result) {
        const workspaceUrl = result.vscode?.workspaceUrl;
        await preloadTaskRunIframes([
          {
            url: workspaceUrl
              ? toProxyWorkspaceUrl(workspaceUrl, localServeWeb.baseUrl)
              : "",
            taskRunId: opts.params.runId,
          },
        ]);
      }
    })();
  },
});

function VSCodeComponent() {
  const { runId: taskRunId, teamSlugOrId } = Route.useParams();
  const localServeWeb = useLocalVSCodeServeWebQuery();
  const taskRun = useSuspenseQuery(
    convexQuery(api.taskRuns.get, {
      teamSlugOrId,
      id: taskRunId,
    })
  );

  const workspaceUrl = taskRun?.data?.vscode?.workspaceUrl
    ? toProxyWorkspaceUrl(
        taskRun.data.vscode.workspaceUrl,
        localServeWeb.data?.baseUrl
      )
    : null;
  const disablePreflight = taskRun?.data?.vscode?.workspaceUrl
    ? shouldUseServerIframePreflight(taskRun.data.vscode.workspaceUrl)
    : false;
  const persistKey = getTaskRunPersistKey(taskRunId);
  const hasWorkspace = workspaceUrl !== null;
  const isLocalWorkspace = taskRun?.data?.vscode?.provider === "other";

  const [iframeStatus, setIframeStatus] =
    useState<PersistentIframeStatus>("loading");
  useEffect(() => {
    setIframeStatus("loading");
  }, [workspaceUrl]);

  const onLoad = useCallback(() => {
    console.log(`Workspace view loaded for task run ${taskRunId}`);
  }, [taskRunId]);

  const onError = useCallback(
    (error: Error) => {
      console.error(
        `Failed to load workspace view for task run ${taskRunId}:`,
        error
      );
    },
    [taskRunId]
  );

  const loadingFallback = useMemo(
    () =>
      isLocalWorkspace ? null : (
        <WorkspaceLoadingIndicator variant="vscode" status="loading" />
      ),
    [isLocalWorkspace]
  );
  const errorFallback = useMemo(
    () => <WorkspaceLoadingIndicator variant="vscode" status="error" />,
    []
  );

  const isEditorBusy = !hasWorkspace || iframeStatus !== "loaded";

  const windowHasFocusRef = useRef(true);

  // Focus the VSCode iframe when the window gains focus
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleWindowFocus = () => {
      // Wait a moment to ensure focus state has stabilized
      setTimeout(() => {
        if (typeof document === "undefined") return;

        // Only update focus state if document is actually visible and focused
        if (document.visibilityState === "visible" && document.hasFocus()) {
          windowHasFocusRef.current = true;

          // Double-check that we're still focused after delay
          setTimeout(() => {
            if (!windowHasFocusRef.current) return;

            // Check if any interactive element has focus
            const activeElement = document.activeElement;
            const isInteractiveElementFocused =
              activeElement instanceof HTMLInputElement ||
              activeElement instanceof HTMLTextAreaElement ||
              activeElement instanceof HTMLButtonElement ||
              activeElement instanceof HTMLSelectElement ||
              (activeElement instanceof HTMLElement &&
                activeElement.isContentEditable);

            // If VSCode is loaded and no UI element has focus, focus the iframe
            if (!isInteractiveElementFocused && hasWorkspace && iframeStatus === "loaded") {
              // For browser iframes
              const iframe = document.querySelector<HTMLIFrameElement>(
                `[data-iframe-key="${persistKey}"] iframe`
              );
              if (iframe?.contentWindow) {
                try {
                  iframe.contentWindow.focus();
                } catch (error) {
                  console.warn("Failed to focus VSCode iframe", error);
                }
              }

              // For Electron WebContentsView
              if (window.cmux?.ui?.focusWebContents) {
                // Get the webContentsId from the iframe element
                const webContentsId = iframe?.getAttribute("data-webcontents-id");
                if (webContentsId) {
                  void window.cmux.ui.focusWebContents(Number(webContentsId))
                    .catch((error) => console.warn("Failed to focus VSCode WebContentsView", error));
                }
              }
            }
          }, 150);
        }
      }, 10);
    };

    const handleWindowBlur = () => {
      windowHasFocusRef.current = false;
    };

    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [persistKey, hasWorkspace, iframeStatus]);

  return (
    <div className="flex flex-col grow bg-neutral-50 dark:bg-black">
      <div className="flex flex-col grow min-h-0 border-l border-neutral-200 dark:border-neutral-800">
        <div
          className="flex flex-row grow min-h-0 relative"
          aria-busy={isEditorBusy}
        >
          {workspaceUrl ? (
            <PersistentWebView
              persistKey={persistKey}
              src={workspaceUrl}
              className="grow flex"
              iframeClassName="select-none"
              sandbox={TASK_RUN_IFRAME_SANDBOX}
              allow={TASK_RUN_IFRAME_ALLOW}
              retainOnUnmount
              suspended={!hasWorkspace}
              preflight={!disablePreflight}
              onLoad={onLoad}
              onError={onError}
              fallback={loadingFallback}
              fallbackClassName="bg-neutral-50 dark:bg-black"
              errorFallback={errorFallback}
              errorFallbackClassName="bg-neutral-50/95 dark:bg-black/95"
              onStatusChange={setIframeStatus}
              loadTimeoutMs={60_000}
            />
          ) : (
            <div className="grow" />
          )}
          {!hasWorkspace && !isLocalWorkspace ? (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <WorkspaceLoadingIndicator variant="vscode" status="loading" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
