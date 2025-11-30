import type { Doc } from "@cmux/convex/dataModel";
import clsx from "clsx";
import { CheckCircle, Clock, ExternalLink, GitPullRequest } from "lucide-react";
import { memo } from "react";

type PreviewRunWithConfig = Doc<"previewRuns"> & {
  config: Doc<"previewConfigs"> | null;
};

interface PreviewItemProps {
  previewRun: PreviewRunWithConfig;
}

export const PreviewItem = memo(function PreviewItem({
  previewRun,
}: PreviewItemProps) {
  const isCompleted = previewRun.status === "completed";
  const isInProgress =
    previewRun.status === "pending" || previewRun.status === "running";
  const isFailed =
    previewRun.status === "failed" || previewRun.status === "skipped";

  const repoName = previewRun.config?.repoFullName?.split("/")[1] ?? "unknown";

  return (
    <div className="relative group w-full">
      <a
        href={previewRun.prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={clsx(
          "relative grid w-full items-center py-2 pr-3 cursor-default select-none group",
          "grid-cols-[24px_36px_1fr_minmax(120px,auto)_58px]",
          "bg-white dark:bg-neutral-900/50 group-hover:bg-neutral-50/90 dark:group-hover:bg-neutral-600/60"
        )}
      >
        <div className="flex items-center justify-center pl-1 -mr-2" />
        <div className="flex items-center justify-center">
          {isCompleted ? (
            <CheckCircle className="w-3.5 h-3.5 text-green-500 dark:text-green-400 flex-shrink-0" />
          ) : isInProgress ? (
            <Clock className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 flex-shrink-0" />
          ) : isFailed ? (
            <div className="w-[9.5px] h-[9.5px] border border-red-400 dark:border-red-500 bg-transparent rounded-full flex-shrink-0" />
          ) : (
            <div className="w-[9.5px] h-[9.5px] border border-neutral-400 dark:border-neutral-500 bg-transparent rounded-full flex-shrink-0" />
          )}
        </div>
        <div className="min-w-0 flex items-center gap-2">
          <GitPullRequest className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500 flex-shrink-0" />
          <span className="text-[13px] font-medium truncate min-w-0 pr-1">
            #{previewRun.prNumber}
          </span>
          {previewRun.headRef && (
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
              {previewRun.headRef}
            </span>
          )}
        </div>
        <div className="text-[11px] text-neutral-400 dark:text-neutral-500 min-w-0 text-right flex items-center justify-end gap-2">
          <span>{repoName}</span>
        </div>
        <div className="text-[11px] text-neutral-400 dark:text-neutral-500 flex-shrink-0 tabular-nums text-right">
          {previewRun.updatedAt &&
            (() => {
              const date = new Date(previewRun.updatedAt);
              const today = new Date();
              const isToday =
                date.getDate() === today.getDate() &&
                date.getMonth() === today.getMonth() &&
                date.getFullYear() === today.getFullYear();

              return (
                <span>
                  {isToday
                    ? date.toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : date.toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}
                </span>
              );
            })()}
        </div>
      </a>
      <div className="right-2 top-0 bottom-0 absolute py-2 group">
        <div className="flex gap-1">
          <a
            href={previewRun.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={clsx(
              "p-1 rounded",
              "bg-neutral-100 dark:bg-neutral-700",
              "text-neutral-600 dark:text-neutral-400",
              "hover:bg-neutral-200 dark:hover:bg-neutral-600",
              "group-hover:opacity-100 opacity-0"
            )}
            title="Open PR"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
});
