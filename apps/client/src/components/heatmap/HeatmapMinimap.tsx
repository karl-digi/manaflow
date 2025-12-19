/**
 * Heatmap minimap component showing file heatmap bars.
 */

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_HEATMAP_COLORS,
  DEFAULT_HEATMAP_COLORS_DARK,
} from "@/lib/heatmap/constants";
import { parseHexColor, mixRgb, rgbaString, clampAlpha } from "@/lib/heatmap/utils";
import { useTheme } from "@/components/theme/use-theme";

export type FileHeatmapScore = {
  filePath: string;
  maxScore: number;
  avgScore: number;
  lineCount: number;
};

export interface HeatmapMinimapProps {
  files: FileHeatmapScore[];
  onFileClick?: (filePath: string) => void;
  selectedFile?: string | null;
  className?: string;
}

function computeHeatmapColor(score: number, isDark: boolean): string {
  const colors = isDark ? DEFAULT_HEATMAP_COLORS_DARK : DEFAULT_HEATMAP_COLORS;
  const lineStart = parseHexColor(colors.line.start);
  const lineEnd = parseHexColor(colors.line.end);

  if (!lineStart || !lineEnd) {
    return "transparent";
  }

  const ratio = Math.min(Math.max(score, 0), 1);
  const color = mixRgb(lineStart, lineEnd, ratio);
  const alpha = clampAlpha(0.5 + ratio * 0.35);

  return rgbaString(color, alpha);
}

function HeatmapMinimapInner({
  files,
  onFileClick,
  selectedFile,
  className,
}: HeatmapMinimapProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => b.maxScore - a.maxScore);
  }, [files]);

  if (files.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {sortedFiles.map((file) => {
        const isSelected = selectedFile === file.filePath;
        const backgroundColor = computeHeatmapColor(file.maxScore, isDark);
        const displayName = file.filePath.split("/").pop() ?? file.filePath;

        return (
          <button
            key={file.filePath}
            type="button"
            onClick={() => onFileClick?.(file.filePath)}
            className={cn(
              "flex items-center gap-2 px-2 py-1 rounded text-left transition-colors",
              "hover:bg-neutral-100 dark:hover:bg-neutral-800",
              isSelected && "bg-neutral-100 dark:bg-neutral-800"
            )}
            title={`${file.filePath}\nMax score: ${Math.round(file.maxScore * 100)}%\nAvg score: ${Math.round(file.avgScore * 100)}%`}
          >
            <div
              className="cmux-heatmap-minimap h-full min-h-[16px] rounded"
              style={{ backgroundColor }}
            />
            <span className="flex-1 truncate text-xs text-neutral-700 dark:text-neutral-300">
              {displayName}
            </span>
            <span className="text-[10px] tabular-nums text-neutral-500 dark:text-neutral-500">
              {Math.round(file.maxScore * 100)}%
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const HeatmapMinimap = memo(HeatmapMinimapInner);
