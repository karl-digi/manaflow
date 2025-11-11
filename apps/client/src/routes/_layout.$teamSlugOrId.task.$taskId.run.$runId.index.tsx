import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PersistentWebView } from "@/components/persistent-webview";
import type { PersistentIframeStatus } from "@/components/persistent-iframe";
import { WorkspaceLoadingIndicator } from "@/components/workspace-loading-indicator";
import { getTaskRunPersistKey } from "@/lib/persistent-webview-keys";
import { toProxyWorkspaceUrl } from "@/lib/toProxyWorkspaceUrl";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import {
  TASK_RUN_IFRAME_ALLOW,
  TASK_RUN_IFRAME_SANDBOX,
  preloadTaskRunIframes,
} from "../lib/preloadTaskRunIframes";
import { shouldUseServerIframePreflight } from "@/hooks/useIframePreflight";
import {
  localVSCodeServeWebQueryOptions,
  useLocalVSCodeServeWebQuery,
} from "@/queries/local-vscode-serve-web";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/"
)({
  component: TaskRunComponent,
  parseParams: (params) => ({
    ...params,
    taskRunId: typedZid("taskRuns").parse(params.runId),
  }),
  loader: async (opts) => {
    convexQueryClient.convexClient.prewarmQuery({
      query: api.taskRuns.get,
      args: {
        teamSlugOrId: opts.params.teamSlugOrId,
        id: opts.params.taskRunId,
      },
    });

    void (async () => {
      const [result, localServeWeb] = await Promise.all([
        opts.context.queryClient.ensureQueryData(
          convexQuery(api.taskRuns.get, {
            teamSlugOrId: opts.params.teamSlugOrId,
            id: opts.params.taskRunId,
          })
        ),
        opts.context.queryClient.ensureQueryData(
          localVSCodeServeWebQueryOptions()
        ),
      ]);
      if (result) {
        const workspaceUrl = result.vscode?.workspaceUrl;
        void preloadTaskRunIframes([
          {
            url: workspaceUrl
              ? toProxyWorkspaceUrl(workspaceUrl, localServeWeb.baseUrl)
              : "",
            taskRunId: opts.params.taskRunId,
          },
        ]);
      }
    })();
  },
});

function TaskRunComponent() {
  const { taskRunId, teamSlugOrId, taskId } = Route.useParams();
  const { addTaskToExpand } = useExpandTasks();
  const localServeWeb = useLocalVSCodeServeWebQuery();
  const taskRun = useSuspenseQuery(
    convexQuery(api.taskRuns.get, {
      teamSlugOrId,
      id: taskRunId,
    })
  );

  // Expand the task and scroll the taskRun into view when the component mounts
  useEffect(() => {
    // Add the task to the expanded list to ensure it's visible
    addTaskToExpand(taskId);

    // Wait for the DOM to update after the expansion
    const scrollToTaskRun = () => {
      // Find the active taskRun element in the sidebar
      // The sidebar marks the current route as active with an 'active' class
      const activeElements = document.querySelectorAll('.active');

      // Find the element that contains our taskRunId in its href
      let targetElement = null;
      for (const element of activeElements) {
        const link = element.querySelector(`[href*="${taskRunId}"]`);
        if (link) {
          targetElement = element;
          break;
        }
      }

      if (!targetElement) {
        // Fallback: try to find any link with the taskRunId
        const linkElement = document.querySelector(`[href*="${taskRunId}"]`);
        if (linkElement) {
          targetElement = linkElement.closest('li') || linkElement.closest('div') || linkElement;
        }
      }

      if (targetElement) {
        // Check if element is already visible in viewport
        const rect = targetElement.getBoundingClientRect();
        const sidebar = targetElement.closest('[class*="sidebar"]') || targetElement.closest('[class*="overflow-y"]');

        if (sidebar) {
          const sidebarRect = sidebar.getBoundingClientRect();
          const isVisible =
            rect.top >= sidebarRect.top &&
            rect.bottom <= sidebarRect.bottom;

          // Only scroll if not already visible
          if (!isVisible) {
            targetElement.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
              inline: 'nearest'
            });
          }
        } else {
          // If we can't find the sidebar, just scroll anyway
          targetElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
          });
        }
      }
    };

    // Use a slightly longer delay to ensure expansion animation completes
    const timeoutId = setTimeout(scrollToTaskRun, 200);

    return () => clearTimeout(timeoutId);
  }, [taskId, taskRunId, addTaskToExpand]);

  const rawWorkspaceUrl = taskRun?.data?.vscode?.workspaceUrl ?? null;
  const workspaceUrl = rawWorkspaceUrl
    ? toProxyWorkspaceUrl(rawWorkspaceUrl, localServeWeb.data?.baseUrl)
    : null;
  const disablePreflight = rawWorkspaceUrl
    ? shouldUseServerIframePreflight(rawWorkspaceUrl)
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
              className="grow flex relative"
              iframeClassName="select-none"
              allow={TASK_RUN_IFRAME_ALLOW}
              sandbox={TASK_RUN_IFRAME_SANDBOX}
              preflight={!disablePreflight}
              retainOnUnmount
              suspended={!hasWorkspace}
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
          {!isLocalWorkspace ? (
            <div
              className={clsx(
                "absolute inset-0 flex items-center justify-center transition pointer-events-none",
                {
                  "opacity-100": !hasWorkspace,
                  "opacity-0": hasWorkspace,
                }
              )}
            >
              <WorkspaceLoadingIndicator variant="vscode" status="loading" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
