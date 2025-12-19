/**
 * Heatmap file sidebar with navigation and minimap.
 */

import { memo, useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme/use-theme";
import { HeatmapThresholdSlider } from "./HeatmapThresholdSlider";
import { HeatmapMinimap, type FileHeatmapScore } from "./HeatmapMinimap";
import {
  DEFAULT_HEATMAP_COLORS,
  DEFAULT_HEATMAP_COLORS_DARK,
} from "@/lib/heatmap/constants";
import { parseHexColor, mixRgb, rgbaString, clampAlpha } from "@/lib/heatmap/utils";
import { ChevronDown, ChevronRight, Flame } from "lucide-react";

export interface HeatmapFileSidebarProps {
  files: FileHeatmapScore[];
  threshold: number;
  onThresholdChange: (value: number) => void;
  onFileClick?: (filePath: string) => void;
  selectedFile?: string | null;
  isLoading?: boolean;
  heatmapEnabled?: boolean;
  onHeatmapToggle?: (enabled: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
}

function HeatmapFileSidebarInner({
  files,
  threshold,
  onThresholdChange,
  onFileClick,
  selectedFile,
  isLoading,
  heatmapEnabled = true,
  onHeatmapToggle,
  className,
  style,
}: HeatmapFileSidebarProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [isExpanded, setIsExpanded] = useState(true);

  const totalScore = useMemo(() => {
    if (files.length === 0) return 0;
    const sum = files.reduce((acc, f) => acc + f.maxScore, 0);
    return sum / files.length;
  }, [files]);

  const highPriorityFiles = useMemo(() => {
    const thresholdScore = threshold / 100;
    return files.filter((f) => f.maxScore >= thresholdScore);
  }, [files, threshold]);

  const colors = isDark ? DEFAULT_HEATMAP_COLORS_DARK : DEFAULT_HEATMAP_COLORS;
  const lineStart = parseHexColor(colors.line.start);
  const lineEnd = parseHexColor(colors.line.end);

  const indicatorColor = useMemo(() => {
    if (!lineStart || !lineEnd) return "transparent";
    const color = mixRgb(lineStart, lineEnd, totalScore);
    return rgbaString(color, clampAlpha(0.7));
  }, [totalScore, lineStart, lineEnd]);

  const handleToggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const handleToggleHeatmap = useCallback(() => {
    onHeatmapToggle?.(!heatmapEnabled);
  }, [heatmapEnabled, onHeatmapToggle]);

  return (
    <div
      className={cn(
        "flex flex-col border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50",
        className
      )}
      style={style}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
        <button
          type="button"
          onClick={handleToggleExpand}
          className="flex items-center gap-1.5 flex-1 min-w-0"
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5 text-neutral-500 flex-shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 text-neutral-500 flex-shrink-0" />
          )}
          <Flame
            className="size-3.5 flex-shrink-0"
            style={{ color: indicatorColor }}
          />
          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300 truncate">
            Review Heatmap
          </span>
        </button>
        <button
          type="button"
          onClick={handleToggleHeatmap}
          className={cn(
            "px-1.5 py-0.5 text-[10px] rounded transition-colors",
            heatmapEnabled
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
              : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500"
          )}
        >
          {heatmapEnabled ? "On" : "Off"}
        </button>
      </div>

      {isExpanded && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Threshold slider */}
          <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
            <HeatmapThresholdSlider
              value={threshold}
              onChange={onThresholdChange}
              disabled={!heatmapEnabled || isLoading}
            />
          </div>

          {/* Stats */}
          <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-xs">
            <span className="text-neutral-500 dark:text-neutral-500">
              Files above threshold
            </span>
            <span className="font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
              {highPriorityFiles.length} / {files.length}
            </span>
          </div>

          {/* File list */}
          <div className="flex-1 overflow-y-auto px-1 py-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-xs text-neutral-500 dark:text-neutral-500 animate-pulse">
                  Analyzing diff...
                </div>
              </div>
            ) : files.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-xs text-neutral-500 dark:text-neutral-500">
                  No heatmap data
                </div>
              </div>
            ) : (
              <HeatmapMinimap
                files={heatmapEnabled ? files : []}
                onFileClick={onFileClick}
                selectedFile={selectedFile}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const HeatmapFileSidebar = memo(HeatmapFileSidebarInner);
