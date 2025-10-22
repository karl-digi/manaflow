import { useMemo } from "react";
import { MonitorUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { TaskRunTerminalSession } from "./task-run-terminal-session";
import { toMorphXtermBaseUrl } from "@/lib/toProxyWorkspaceUrl";
import { terminalTabsQueryOptions } from "@/queries/terminals";

export interface TaskRunTerminalPaneProps {
  workspaceUrl: string | null;
}

export function TaskRunTerminalPane({ workspaceUrl }: TaskRunTerminalPaneProps) {
  const baseUrl = useMemo(() => {
    if (!workspaceUrl) {
      return null;
    }
    return toMorphXtermBaseUrl(workspaceUrl);
  }, [workspaceUrl]);

  const hasTerminalBackend = Boolean(baseUrl);
  const tabsQuery = useQuery(
    terminalTabsQueryOptions({
      baseUrl,
      contextKey: workspaceUrl,
      enabled: hasTerminalBackend,
    })
  );

  const {
    data: tabs,
    isLoading: isTabsLoading,
    isError: isTabsError,
    error: tabsError,
  } = tabsQuery;

  const activeTerminalId = tabs?.[0] ?? null;

  if (!workspaceUrl || !baseUrl) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        <MonitorUp className="size-4 animate-pulse" aria-hidden />
        <span>Terminal is starting...</span>
      </div>
    );
  }

  if (isTabsLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        <MonitorUp className="size-4 animate-pulse" aria-hidden />
        <span>Loading terminal...</span>
      </div>
    );
  }

  if (isTabsError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        <MonitorUp className="size-4 text-red-500" aria-hidden />
        <span className="text-red-500 dark:text-red-400">
          {tabsError instanceof Error ? tabsError.message : "Failed to load terminal"}
        </span>
      </div>
    );
  }

  if (!activeTerminalId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-neutral-500 dark:text-neutral-400">
        <MonitorUp className="size-4 animate-pulse" aria-hidden />
        <span>Waiting for a terminal session...</span>
        <span className="text-xs text-neutral-400 dark:text-neutral-500">
          Try reloading the page if this persists.
        </span>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-black">
      <TaskRunTerminalSession
        baseUrl={baseUrl}
        terminalId={activeTerminalId}
        isActive={true}
      />
    </div>
  );
}
