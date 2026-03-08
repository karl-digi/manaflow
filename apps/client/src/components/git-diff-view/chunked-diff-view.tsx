import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import type { DiffFileHighlighter, DiffFile } from "@git-diff-view/core";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import {
  INITIAL_VISIBLE_LINES,
  CHUNK_SIZE,
  LINE_HEIGHT_ESTIMATE,
  VIEWPORT_RENDER_MARGIN,
} from "./types";

interface ChunkedDiffViewProps {
  diffFile: DiffFile;
  totalLines: number;
  mode: DiffModeEnum;
  theme: "light" | "dark";
  registerHighlighter?: DiffFileHighlighter;
}

/**
 * ChunkedDiffView wraps DiffView with progressive height expansion.
 * Uses CSS max-height to reveal lines incrementally as user scrolls,
 * leveraging browser's native lazy painting optimization.
 */
function ChunkedDiffView({
  diffFile,
  totalLines,
  mode,
  theme,
  registerHighlighter,
}: ChunkedDiffViewProps) {
  const [visibleLines, setVisibleLines] = useState(INITIAL_VISIBLE_LINES);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const remainingLines = Math.max(0, totalLines - visibleLines);
  const isFullyLoaded = remainingLines === 0;

  // Calculate height based on visible lines
  // Use explicit height (not max-height) to ensure proper clipping
  const calculatedHeight = visibleLines * LINE_HEIGHT_ESTIMATE;

  const loadMoreLines = useCallback(() => {
    setVisibleLines((prev) => {
      const next = prev + CHUNK_SIZE;
      return next >= totalLines ? totalLines : next;
    });
  }, [totalLines]);

  // IntersectionObserver to trigger loading when sentinel enters viewport
  useEffect(() => {
    if (isFullyLoaded) {
      return;
    }

    if (typeof window === "undefined" || typeof IntersectionObserver !== "function") {
      // Fallback: load everything if IntersectionObserver not available
      setVisibleLines(totalLines);
      return;
    }

    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          loadMoreLines();
        }
      },
      { rootMargin: VIEWPORT_RENDER_MARGIN, threshold: 0 }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [isFullyLoaded, loadMoreLines, totalLines]);

  return (
    <div ref={containerRef} className="relative">
      {/* Diff content with progressive height - GPU-optimized for smooth scrolling */}
      <div
        className={cn(
          "cmux-git-diff-view w-full overflow-x-auto border-t border-neutral-200/80 dark:border-neutral-800/70",
          !isFullyLoaded && "overflow-y-hidden"
        )}
        style={
          isFullyLoaded
            ? undefined
            : {
                maxHeight: `${calculatedHeight}px`,
                transition: "max-height 200ms ease-out",
                willChange: "max-height",
              }
        }
      >
        <DiffView
          diffFile={diffFile}
          diffViewMode={mode}
          diffViewTheme={theme}
          diffViewWrap={true}
          diffViewFontSize={13}
          diffViewHighlight={Boolean(registerHighlighter)}
          registerHighlighter={registerHighlighter}
        />
      </div>

      {/* Load more sentinel and button */}
      {!isFullyLoaded && (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center gap-2 border-t border-neutral-200/80 bg-neutral-50 py-2 dark:border-neutral-800/70 dark:bg-neutral-900/50"
        >
          <button
            type="button"
            onClick={loadMoreLines}
            className="text-xs text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            Load more lines ({remainingLines} remaining)
          </button>
          <span className="text-xs text-neutral-400 dark:text-neutral-500">|</span>
          <button
            type="button"
            onClick={() => setVisibleLines(totalLines)}
            className="text-xs text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            Load all
          </button>
        </div>
      )}
    </div>
  );
}

export const MemoChunkedDiffView = memo(ChunkedDiffView, (prev, next) => {
  return (
    prev.diffFile === next.diffFile &&
    prev.totalLines === next.totalLines &&
    prev.mode === next.mode &&
    prev.theme === next.theme &&
    prev.registerHighlighter === next.registerHighlighter
  );
});
