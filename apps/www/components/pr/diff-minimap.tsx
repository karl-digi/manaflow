"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { DiffHeatmap } from "./heatmap";

type MinimapFile = {
  filename: string;
  anchorId: string;
  lineCount: number;
  heatmap: DiffHeatmap | null;
  addedLines: number;
  deletedLines: number;
};

type DiffMinimapProps = {
  files: MinimapFile[];
  activeAnchor: string;
  onNavigate: (anchorId: string) => void;
  className?: string;
};

type MinimapBlock = {
  anchorId: string;
  filename: string;
  startY: number;
  height: number;
  maxScore: number;
  avgScore: number;
  addedLines: number;
  deletedLines: number;
};

const MINIMAP_LINE_HEIGHT = 2; // pixels per line in minimap
const MINIMAP_MIN_BLOCK_HEIGHT = 8; // minimum block height for visibility
const MINIMAP_PADDING = 4;
const MINIMAP_WIDTH = 120;

export const DiffMinimap = memo(function DiffMinimapComponent({
  files,
  activeAnchor,
  onNavigate,
  className,
}: DiffMinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportRect, setViewportRect] = useState<{
    top: number;
    height: number;
  } | null>(null);
  const [hoveredBlock, setHoveredBlock] = useState<string | null>(null);

  // Calculate minimap blocks
  const blocks = useMemo<MinimapBlock[]>(() => {
    let currentY = MINIMAP_PADDING;
    const result: MinimapBlock[] = [];

    for (const file of files) {
      const lineCount = Math.max(file.lineCount, 1);
      const rawHeight = lineCount * MINIMAP_LINE_HEIGHT;
      const height = Math.max(rawHeight, MINIMAP_MIN_BLOCK_HEIGHT);

      // Calculate heatmap scores
      let maxScore = 0;
      let totalScore = 0;
      let scoreCount = 0;

      if (file.heatmap) {
        const allEntries = [
          ...Array.from(file.heatmap.entries.values()),
          ...Array.from(file.heatmap.oldEntries.values()),
        ];

        for (const entry of allEntries) {
          if (entry.score !== null && entry.score > 0) {
            maxScore = Math.max(maxScore, entry.score);
            totalScore += entry.score;
            scoreCount++;
          }
        }
      }

      const avgScore = scoreCount > 0 ? totalScore / scoreCount : 0;

      result.push({
        anchorId: file.anchorId,
        filename: file.filename,
        startY: currentY,
        height,
        maxScore,
        avgScore,
        addedLines: file.addedLines,
        deletedLines: file.deletedLines,
      });

      currentY += height + 2; // 2px gap between files
    }

    return result;
  }, [files]);

  const totalHeight = useMemo(() => {
    if (blocks.length === 0) return 0;
    const lastBlock = blocks[blocks.length - 1];
    if (!lastBlock) return 0;
    return lastBlock.startY + lastBlock.height + MINIMAP_PADDING;
  }, [blocks]);

  // Track viewport position
  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateViewportRect = () => {
      const container = containerRef.current;
      if (!container) return;

      const viewportHeight = window.innerHeight;
      const scrollTop = window.scrollY;
      const scrollHeight = document.documentElement.scrollHeight;

      // Calculate viewport position relative to total scroll
      const scrollRatio = scrollTop / Math.max(scrollHeight - viewportHeight, 1);
      const viewportHeightRatio = viewportHeight / scrollHeight;

      // Map to minimap coordinates
      const top = scrollRatio * totalHeight;
      const height = Math.max(viewportHeightRatio * totalHeight, 20);

      setViewportRect({ top, height });
    };

    updateViewportRect();
    window.addEventListener("scroll", updateViewportRect, { passive: true });
    window.addEventListener("resize", updateViewportRect, { passive: true });

    return () => {
      window.removeEventListener("scroll", updateViewportRect);
      window.removeEventListener("resize", updateViewportRect);
    };
  }, [totalHeight]);

  const handleBlockClick = useCallback(
    (anchorId: string) => {
      onNavigate(anchorId);
    },
    [onNavigate]
  );

  const handleMinimapClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const y = event.clientY - rect.top;

      // Find which block was clicked
      const block = blocks.find(
        (b) => y >= b.startY && y <= b.startY + b.height
      );

      if (block) {
        handleBlockClick(block.anchorId);
      }
    },
    [blocks, handleBlockClick]
  );

  const getBlockColor = useCallback((block: MinimapBlock): string => {
    if (block.maxScore === 0) {
      // No heatmap data - show neutral color based on change type
      if (block.addedLines > 0 && block.deletedLines === 0) {
        return "rgb(34, 197, 94)"; // green for additions
      }
      if (block.deletedLines > 0 && block.addedLines === 0) {
        return "rgb(239, 68, 68)"; // red for deletions
      }
      return "rgb(163, 163, 163)"; // neutral gray for modifications
    }

    // Use heatmap intensity - interpolate from yellow to orange-red
    const intensity = Math.min(block.avgScore, 1);
    const r = 253;
    const g = Math.round(224 - intensity * (224 - 186));
    const b = Math.round(71 - intensity * (71 - 12));

    return `rgb(${r}, ${g}, ${b})`;
  }, []);

  const getBlockOpacity = useCallback(
    (block: MinimapBlock): number => {
      if (block.anchorId === activeAnchor) {
        return 0.95;
      }
      if (hoveredBlock === block.anchorId) {
        return 0.85;
      }
      if (block.maxScore > 0) {
        return 0.4 + block.maxScore * 0.4;
      }
      return 0.35;
    },
    [activeAnchor, hoveredBlock]
  );

  if (files.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed right-4 top-20 z-40 rounded-lg border border-neutral-200 bg-white/95 shadow-lg backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-900/95",
        className
      )}
      style={{
        width: MINIMAP_WIDTH,
        maxHeight: "calc(100vh - 160px)",
        overflowY: "auto",
      }}
      onClick={handleMinimapClick}
      role="navigation"
      aria-label="Diff minimap"
    >
      <div
        className="relative cursor-pointer"
        style={{ height: totalHeight }}
      >
        {/* File blocks */}
        {blocks.map((block) => (
          <div
            key={block.anchorId}
            className={cn(
              "absolute left-1 right-1 rounded-sm transition-all duration-150",
              block.anchorId === activeAnchor &&
                "ring-2 ring-sky-500 ring-offset-1 dark:ring-sky-400"
            )}
            style={{
              top: block.startY,
              height: block.height,
              backgroundColor: getBlockColor(block),
              opacity: getBlockOpacity(block),
            }}
            onMouseEnter={() => setHoveredBlock(block.anchorId)}
            onMouseLeave={() => setHoveredBlock(null)}
            title={`${block.filename}${
              block.maxScore > 0
                ? ` (score: ${block.maxScore.toFixed(2)})`
                : ""
            }`}
          />
        ))}

        {/* Viewport indicator */}
        {viewportRect && (
          <div
            className="pointer-events-none absolute left-0 right-0 border-2 border-sky-500/60 bg-sky-500/10 dark:border-sky-400/60 dark:bg-sky-400/10"
            style={{
              top: viewportRect.top,
              height: viewportRect.height,
            }}
          />
        )}
      </div>

      {/* Minimap header */}
      <div className="sticky top-0 border-b border-neutral-200 bg-white/95 px-2 py-1 text-center backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-900/95">
        <span className="text-[10px] font-medium text-neutral-600 dark:text-neutral-400">
          MINIMAP
        </span>
      </div>
    </div>
  );
});
