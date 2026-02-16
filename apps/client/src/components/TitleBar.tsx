import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSidebarOptional } from "@/contexts/sidebar/SidebarContext";
import { isElectron } from "@/lib/electron";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronRight, Plus } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import CmuxLogoMark from "./logo/cmux-logo-mark";

const HIDDEN_SIDEBAR_TOGGLE_LEFT_OFFSET = "calc(-1px - 0.375rem)";

export function TitleBar({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  const sidebar = useSidebarOptional();
  const params = useParams({ strict: false });
  const teamSlugOrId =
    typeof params.teamSlugOrId === "string" ? params.teamSlugOrId : undefined;
  const showSidebarToggle = sidebar?.isHidden && teamSlugOrId;

  return (
    <div
      className="h-[38px] border-b border-neutral-200/70 dark:border-neutral-800/50 flex items-center justify-center relative select-none"
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
    >
      {/* Left side: toggle icons when sidebar hidden - same X position as sidebar header icons */}
      {showSidebarToggle && (
        <div
          className={`absolute inset-y-0 flex items-center -translate-y-px ${isElectron ? "" : "pl-3"}`}
          style={{
            WebkitAppRegion: "no-drag",
            // Offset FloatingPane's left gutter: 1px border + 0.375rem (6px) pane padding.
            left: HIDDEN_SIDEBAR_TOGGLE_LEFT_OFFSET,
          } as CSSProperties}
        >
          {/* Match sidebar layout exactly by replicating the invisible logo+text structure */}
          {isElectron && <div className="w-[80px]" />}
          {/* Invisible placeholder matching sidebar's logo + text + gap for pixel-perfect alignment */}
          <div className="flex items-center gap-1.5 invisible" aria-hidden="true">
            <CmuxLogoMark height={20} />
            <span className="text-xs font-semibold tracking-wide whitespace-nowrap">
              cmux-next
            </span>
          </div>

          <div className="flex items-center gap-1 ml-2">
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => sidebar.setIsHidden(false)}
                  className="w-[25px] h-[25px] border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-lg flex items-center justify-center transition-colors cursor-default"
                  aria-label="Show sidebar"
                >
                  <ChevronRight
                    className="w-4 h-4 text-neutral-700 dark:text-neutral-300"
                    aria-hidden="true"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                showArrow={false}
                className="bg-neutral-200 text-neutral-700 border border-neutral-300 shadow-sm px-2 py-1 dark:bg-neutral-700 dark:text-neutral-100 dark:border-neutral-600"
              >
                Show sidebar Ctrl+Shift+S
              </TooltipContent>
            </Tooltip>

            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Link
                  to="/$teamSlugOrId/dashboard"
                  params={{ teamSlugOrId }}
                  activeOptions={{ exact: true }}
                  className="w-[25px] h-[25px] border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-lg flex items-center justify-center transition-colors cursor-default"
                  aria-label="New task"
                >
                  <Plus
                    className="w-4 h-4 text-neutral-700 dark:text-neutral-300"
                    aria-hidden="true"
                  />
                </Link>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                showArrow={false}
                className="bg-neutral-200 text-neutral-700 border border-neutral-300 shadow-sm px-2 py-1 dark:bg-neutral-700 dark:text-neutral-100 dark:border-neutral-600"
              >
                New task
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Title - centered */}
      <div className="flex items-center text-xs font-medium text-neutral-900 dark:text-neutral-100">
        <span>{title}</span>
      </div>

      {/* Right side: actions */}
      {actions ? (
        <div
          className="absolute inset-y-0 right-3 flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
