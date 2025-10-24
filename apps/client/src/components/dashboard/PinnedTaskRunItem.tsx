import { OpenWithDropdown } from "@/components/OpenWithDropdown";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePinTaskRun } from "@/hooks/usePinTaskRun";
import type { Doc } from "@cmux/convex/dataModel";
import { api } from "@cmux/convex/api";
import { useClipboard } from "@mantine/hooks";
import { useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { ContextMenu } from "@base-ui-components/react/context-menu";
import { ArrowUpRight, Check, Copy, Pin } from "lucide-react";
import { memo, useCallback, useMemo } from "react";

type PinnedTaskRun = (typeof api.taskRuns.getPinned._returnType)[number];

interface PinnedTaskRunItemProps {
  item: PinnedTaskRun;
  teamSlugOrId: string;
}

const STATUS_COLORS: Record<
  PinnedTaskRun["status"],
  string
> = {
  pending: "bg-yellow-500",
  running: "bg-blue-500 animate-pulse",
  completed: "bg-green-500",
  failed: "bg-red-500",
};

const summarizeRun = (item: PinnedTaskRun): string => {
  const summary = item.summary?.trim();
  if (summary) {
    return summary;
  }
  const agent = item.agentName?.trim();
  if (agent) {
    return agent;
  }
  return item.prompt.length > 80
    ? `${item.prompt.slice(0, 77)}...`
    : item.prompt;
};

export const PinnedTaskRunItem = memo(function PinnedTaskRunItem({
  item,
  teamSlugOrId,
}: PinnedTaskRunItemProps) {
  const navigate = useNavigate();
  const clipboard = useClipboard({ timeout: 2000 });
  const { setPinned } = usePinTaskRun(teamSlugOrId);

  const runSummary = useMemo(() => summarizeRun(item), [item]);
  const statusClass = useMemo(
    () => STATUS_COLORS[item.status] ?? "bg-neutral-400",
    [item.status],
  );

  const handleOpenRun = useCallback(() => {
    navigate({
      to: "/$teamSlugOrId/task/$taskId/run/$runId",
      params: {
        teamSlugOrId,
        taskId: item.taskId,
        runId: item._id,
        taskRunId: item._id,
      },
    });
  }, [item._id, item.taskId, navigate, teamSlugOrId]);

  const handleOpenTask = useCallback(() => {
    navigate({
      to: "/$teamSlugOrId/task/$taskId",
      params: { teamSlugOrId, taskId: item.taskId },
      search: { runId: item._id },
    });
  }, [item._id, item.taskId, navigate, teamSlugOrId]);

  const handleClick = useCallback(() => {
    handleOpenRun();
  }, [handleOpenRun]);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      clipboard.copy(runSummary);
    },
    [clipboard, runSummary],
  );

  const handleCopyFromMenu = useCallback(() => {
    clipboard.copy(runSummary);
  }, [clipboard, runSummary]);

  const handleTogglePinned = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setPinned(item._id, item.taskId, !item.isPinned);
    },
    [item._id, item.isPinned, item.taskId, setPinned],
  );

  const handleTogglePinnedFromMenu = useCallback(() => {
    setPinned(item._id, item.taskId, !item.isPinned);
  }, [item._id, item.isPinned, item.taskId, setPinned]);

  const task: Doc<"tasks"> | undefined = item.task;
  const vscodeStatus = item.vscode?.status;
  const hasActiveVSCode = vscodeStatus === "running";
  const vscodeUrl =
    hasActiveVSCode && item.vscode?.workspaceUrl
      ? item.vscode.workspaceUrl
      : null;
  const worktreePath = item.worktreePath ?? task?.worktreePath;

  return (
    <div className="relative group">
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <div
            className={clsx(
              "relative flex items-center gap-2.5 px-3 py-2 border rounded-lg transition-all cursor-default select-none",
              "bg-white dark:bg-neutral-700/50 border-neutral-200 dark:border-neutral-500/15 hover:border-neutral-300 dark:hover:border-neutral-500/30",
            )}
            onClick={handleClick}
          >
            <div
              className={clsx(
                "w-1.5 h-1.5 rounded-full flex-shrink-0",
                statusClass,
              )}
            />
            <Pin className="w-3 h-3 text-blue-500 dark:text-blue-400 flex-shrink-0" />
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="text-[14px] truncate min-w-0">
                {task?.text ?? "Task"}
              </span>
              <span className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                Run: {runSummary}
              </span>
            </div>
            {item.updatedAt ? (
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500 flex-shrink-0 ml-auto mr-0 tabular-nums">
                {new Date(item.updatedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            ) : null}
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="outline-none z-[var(--z-context-menu)]">
            <ContextMenu.Popup className="origin-[var(--transform-origin)] rounded-md bg-white dark:bg-neutral-800 py-1 text-neutral-900 dark:text-neutral-100 shadow-lg shadow-gray-200 outline-1 outline-neutral-200 transition-[opacity] data-[ending-style]:opacity-0 dark:shadow-none dark:-outline-offset-1 dark:outline-neutral-700">
              <ContextMenu.Item
                className="flex items-center gap-2 cursor-default py-1.5 pr-8 pl-3 text-[13px] leading-5 outline-none select-none data-[highlighted]:relative data-[highlighted]:z-0 data-[highlighted]:text-white data-[highlighted]:before:absolute data-[highlighted]:before:inset-x-1 data-[highlighted]:before:inset-y-0 data-[highlighted]:before:z-[-1] data-[highlighted]:before:rounded-sm data-[highlighted]:before:bg-neutral-900 dark:data-[highlighted]:before:bg-neutral-700"
                onClick={handleTogglePinnedFromMenu}
              >
                <Pin className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
                <span>{item.isPinned ? "Unpin Run" : "Pin Run"}</span>
              </ContextMenu.Item>
              <ContextMenu.Item
                className="flex items-center gap-2 cursor-default py-1.5 pr-8 pl-3 text-[13px] leading-5 outline-none select-none data-[highlighted]:relative data-[highlighted]:z-0 data-[highlighted]:text-white data-[highlighted]:before:absolute data-[highlighted]:before:inset-x-1 data-[highlighted]:before:inset-y-0 data-[highlighted]:before:z-[-1] data-[highlighted]:before:rounded-sm data-[highlighted]:before:bg-neutral-900 dark:data-[highlighted]:before:bg-neutral-700"
                onClick={handleCopyFromMenu}
              >
                <Copy className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
                <span>Copy Summary</span>
              </ContextMenu.Item>
              <ContextMenu.Item
                className="flex items-center gap-2 cursor-default py-1.5 pr-8 pl-3 text-[13px] leading-5 outline-none select-none data-[highlighted]:relative data-[highlighted]:z-0 data-[highlighted]:text-white data-[highlighted]:before:absolute data-[highlighted]:before:inset-x-1 data-[highlighted]:before:inset-y-0 data-[highlighted]:before:z-[-1] data-[highlighted]:before:rounded-sm data-[highlighted]:before:bg-neutral-900 dark:data-[highlighted]:before:bg-neutral-700"
                onClick={handleOpenTask}
              >
                <ArrowUpRight className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
                <span>Open Task</span>
              </ContextMenu.Item>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <div className="right-2 top-0 bottom-0 absolute py-2">
        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleCopy}
                className={clsx(
                  "p-1 rounded",
                  "bg-neutral-100 dark:bg-neutral-700",
                  "text-neutral-600 dark:text-neutral-400",
                  "hover:bg-neutral-200 dark:hover:bg-neutral-600",
                  "group-hover:opacity-100 opacity-0",
                )}
                title="Copy run summary"
              >
                {clipboard.copied ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {clipboard.copied ? "Copied!" : "Copy summary"}
            </TooltipContent>
          </Tooltip>

          <OpenWithDropdown
            vscodeUrl={vscodeUrl}
            worktreePath={worktreePath}
            branch={task?.baseBranch}
            className="group-hover:opacity-100 aria-expanded:opacity-100 opacity-0"
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleTogglePinned}
                className={clsx(
                  "p-1 rounded",
                  "bg-neutral-100 dark:bg-neutral-700",
                  item.isPinned
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-neutral-600 dark:text-neutral-400",
                  "hover:bg-neutral-200 dark:hover:bg-neutral-600",
                  "group-hover:opacity-100 opacity-0",
                )}
                title={item.isPinned ? "Unpin run" : "Pin run"}
              >
                <Pin className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {item.isPinned ? "Unpin run" : "Pin run"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
});
