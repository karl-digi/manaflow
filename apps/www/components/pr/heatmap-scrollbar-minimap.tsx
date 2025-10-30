"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { DiffHeatmap } from "./heatmap";

type HeatmapScrollbarMinimapProps = {
  fileEntries: Array<{
    entry: {
      anchorId: string;
      file: { filename: string };
    };
    diffHeatmap: DiffHeatmap | null;
  }>;
  onNavigateToLine?: (anchorId: string, lineNumber: number, side: "new" | "old") => void;
};

type HeatmapSegment = {
  anchorId: string;
  lineNumber: number;
  side: "new" | "old";
  tier: number;
  offsetPercent: number;
  heightPercent: number;
};

export function HeatmapScrollbarMinimap({
  fileEntries,
  onNavigateToLine,
}: HeatmapScrollbarMinimapProps) {
  const [segments, setSegments] = useState<HeatmapSegment[]>([]);
  const [viewportPosition, setViewportPosition] = useState({ top: 0, height: 100 });
  const minimapRef = useRef<HTMLDivElement>(null);

  // Calculate heatmap segments from file entries
  useEffect(() => {
    const newSegments: HeatmapSegment[] = [];
    const allElements: HTMLElement[] = [];

    // Collect all file elements and their heatmap data
    for (const fileEntry of fileEntries) {
      const element = document.getElementById(fileEntry.entry.anchorId);
      if (element) {
        allElements.push(element);
      }
    }

    if (allElements.length === 0) {
      setSegments([]);
      return;
    }

    // Calculate total scroll height
    const documentHeight = document.documentElement.scrollHeight;
    const windowHeight = window.innerHeight;

    // Process each file's heatmap
    for (const fileEntry of fileEntries) {
      const { diffHeatmap, entry } = fileEntry;
      if (!diffHeatmap) continue;

      const element = document.getElementById(entry.anchorId);
      if (!element) continue;

      const fileTop = element.offsetTop;
      const fileHeight = element.offsetHeight;

      // Process new line entries
      for (const [lineNumber, heatmapLine] of diffHeatmap.entries) {
        const tier = extractTierFromScore(heatmapLine.score);
        if (tier === 0) continue;

        // Estimate line position within the file (approximate)
        const lineOffset = fileTop + (fileHeight * lineNumber) / 100;
        const offsetPercent = (lineOffset / documentHeight) * 100;
        const heightPercent = Math.max(0.5, (windowHeight * 0.5) / documentHeight * 100);

        newSegments.push({
          anchorId: entry.anchorId,
          lineNumber,
          side: "new",
          tier,
          offsetPercent,
          heightPercent,
        });
      }

      // Process old line entries
      for (const [lineNumber, heatmapLine] of diffHeatmap.oldEntries) {
        const tier = extractTierFromScore(heatmapLine.score);
        if (tier === 0) continue;

        const lineOffset = fileTop + (fileHeight * lineNumber) / 100;
        const offsetPercent = (lineOffset / documentHeight) * 100;
        const heightPercent = Math.max(0.5, (windowHeight * 0.5) / documentHeight * 100);

        newSegments.push({
          anchorId: entry.anchorId,
          lineNumber,
          side: "old",
          tier,
          offsetPercent,
          heightPercent,
        });
      }
    }

    setSegments(newSegments);
  }, [fileEntries]);

  // Update viewport position on scroll
  useEffect(() => {
    const updateViewportPosition = () => {
      const scrollTop = window.scrollY;
      const scrollHeight = document.documentElement.scrollHeight;
      const windowHeight = window.innerHeight;

      const topPercent = (scrollTop / scrollHeight) * 100;
      const heightPercent = (windowHeight / scrollHeight) * 100;

      setViewportPosition({
        top: topPercent,
        height: heightPercent,
      });
    };

    updateViewportPosition();
    window.addEventListener("scroll", updateViewportPosition);
    window.addEventListener("resize", updateViewportPosition);

    return () => {
      window.removeEventListener("scroll", updateViewportPosition);
      window.removeEventListener("resize", updateViewportPosition);
    };
  }, []);

  // Handle clicks on the minimap to navigate
  const handleMinimapClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const clickY = event.clientY - rect.top;
      const clickPercent = (clickY / rect.height) * 100;

      // Find the nearest segment
      const nearestSegment = segments.reduce<HeatmapSegment | null>(
        (nearest, segment) => {
          const distance = Math.abs(segment.offsetPercent - clickPercent);
          if (!nearest) return segment;
          const nearestDistance = Math.abs(nearest.offsetPercent - clickPercent);
          return distance < nearestDistance ? segment : nearest;
        },
        null
      );

      if (nearestSegment && onNavigateToLine) {
        onNavigateToLine(
          nearestSegment.anchorId,
          nearestSegment.lineNumber,
          nearestSegment.side
        );
      }

      // Scroll to the clicked position
      const scrollHeight = document.documentElement.scrollHeight;
      const targetScrollTop = (clickPercent / 100) * scrollHeight;
      window.scrollTo({ top: targetScrollTop, behavior: "smooth" });
    },
    [segments, onNavigateToLine]
  );

  if (segments.length === 0) {
    return null;
  }

  return (
    <div
      ref={minimapRef}
      className="heatmap-scrollbar-minimap"
      onClick={handleMinimapClick}
      role="navigation"
      aria-label="Heatmap scrollbar minimap"
    >
      {/* Viewport indicator */}
      <div
        className="heatmap-minimap-viewport"
        style={{
          top: `${viewportPosition.top}%`,
          height: `${viewportPosition.height}%`,
        }}
      />

      {/* Heatmap segments */}
      {segments.map((segment, index) => (
        <div
          key={`${segment.anchorId}-${segment.side}-${segment.lineNumber}-${index}`}
          className={`heatmap-minimap-segment heatmap-minimap-tier-${segment.tier}`}
          style={{
            top: `${segment.offsetPercent}%`,
            height: `${segment.heightPercent}%`,
          }}
          title={`Line ${segment.lineNumber} (tier ${segment.tier})`}
        />
      ))}
    </div>
  );
}

function extractTierFromScore(score: number | null): number {
  if (score === null || score <= 0) {
    return 0;
  }

  const HEATMAP_TIERS = [0.2, 0.4, 0.6, 0.8];
  for (let index = HEATMAP_TIERS.length - 1; index >= 0; index--) {
    if (score >= HEATMAP_TIERS[index]!) {
      return index + 1;
    }
  }

  return score > 0 ? 1 : 0;
}
