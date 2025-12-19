/**
 * HeatmapDiffViewer - Wraps Monaco diff viewer with heatmap visualization.
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme/use-theme";
import { GitDiffViewer, type GitDiffViewerProps } from "@/components/git-diff-viewer";
import { HeatmapFileSidebar } from "./HeatmapFileSidebar";
import { injectHeatmapGradientStyles } from "@/lib/heatmap/gradient-styles";
import { buildDiffHeatmap, type DiffLine } from "@/lib/heatmap/build-heatmap";
import type { DiffHeatmap, ResolvedHeatmapLine } from "@/lib/heatmap/types";
import type { FileHeatmapScore } from "./HeatmapMinimap";
import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";

export interface HeatmapData {
  lineNumber: number | null;
  lineText: string | null;
  score: number | null;
  reason: string | null;
  mostImportantWord: string | null;
}

export interface HeatmapDiffViewerProps extends Omit<GitDiffViewerProps, "classNames"> {
  heatmapData?: HeatmapData[];
  isHeatmapLoading?: boolean;
  showHeatmapSidebar?: boolean;
  sidebarWidth?: number;
  classNames?: GitDiffViewerProps["classNames"] & {
    sidebar?: string;
  };
}

function convertDiffsToLines(diffs: ReplaceDiffEntry[]): DiffLine[] {
  const lines: DiffLine[] = [];

  for (const diff of diffs) {
    const oldContent = diff.oldContent ?? "";
    const newContent = diff.newContent ?? "";

    const oldLines = oldContent.split(/\r?\n/);
    const newLines = newContent.split(/\r?\n/);

    // For each new line, create a line entry
    for (let i = 0; i < newLines.length; i++) {
      const content = newLines[i] ?? "";
      lines.push({
        content: `+${content}`,
        type: "insert",
        newLineNumber: i + 1,
      });
    }

    // For each old line, create a line entry
    for (let i = 0; i < oldLines.length; i++) {
      const content = oldLines[i] ?? "";
      lines.push({
        content: `-${content}`,
        type: "delete",
        oldLineNumber: i + 1,
      });
    }
  }

  return lines;
}

function computeFileScores(
  diffs: ReplaceDiffEntry[],
  heatmap: DiffHeatmap
): FileHeatmapScore[] {
  const fileScores: FileHeatmapScore[] = [];

  for (const diff of diffs) {
    const allEntries: ResolvedHeatmapLine[] = [];

    // Collect entries for this file
    for (const [, entry] of heatmap.entries) {
      allEntries.push(entry);
    }
    for (const [, entry] of heatmap.oldEntries) {
      allEntries.push(entry);
    }

    const scores = allEntries
      .map((e) => e.score)
      .filter((s): s is number => s !== null);

    const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
    const avgScore =
      scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;

    fileScores.push({
      filePath: diff.filePath,
      maxScore,
      avgScore,
      lineCount: diff.additions + diff.deletions,
    });
  }

  return fileScores;
}

function HeatmapDiffViewerInner({
  diffs,
  heatmapData,
  isHeatmapLoading,
  showHeatmapSidebar = true,
  sidebarWidth = 220,
  classNames,
  onControlsChange,
  onFileToggle,
}: HeatmapDiffViewerProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [heatmapEnabled, setHeatmapEnabled] = useState(true);
  const [threshold, setThreshold] = useState(0);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const diffContainerRef = useRef<HTMLDivElement>(null);

  // Inject gradient styles
  useEffect(() => {
    const cleanup = injectHeatmapGradientStyles(undefined, isDark);
    return cleanup;
  }, [isDark]);

  // Build heatmap from data
  const heatmap = useMemo<DiffHeatmap | null>(() => {
    if (!heatmapData || heatmapData.length === 0 || !heatmapEnabled) {
      return null;
    }

    const diffLines = convertDiffsToLines(diffs);
    return buildDiffHeatmap(heatmapData, diffLines, {
      minScore: 0,
      thresholdPercent: threshold,
    });
  }, [diffs, heatmapData, heatmapEnabled, threshold]);

  // Compute file scores for sidebar
  const fileScores = useMemo<FileHeatmapScore[]>(() => {
    if (!heatmap) {
      return diffs.map((diff) => ({
        filePath: diff.filePath,
        maxScore: 0,
        avgScore: 0,
        lineCount: diff.additions + diff.deletions,
      }));
    }

    return computeFileScores(diffs, heatmap);
  }, [diffs, heatmap]);

  // Handle file click in sidebar
  const handleFileClick = useCallback((filePath: string) => {
    setSelectedFile(filePath);

    // Scroll to the file header in the diff view
    const container = diffContainerRef.current;
    if (!container) return;

    const fileHeader = container.querySelector(
      `[data-file-path="${CSS.escape(filePath)}"]`
    );
    if (fileHeader) {
      fileHeader.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // Handle threshold change
  const handleThresholdChange = useCallback((value: number) => {
    setThreshold(value);
  }, []);

  // Handle heatmap toggle
  const handleHeatmapToggle = useCallback((enabled: boolean) => {
    setHeatmapEnabled(enabled);
  }, []);

  // Enhanced classNames with data-file-path attribute support
  const enhancedClassNames = useMemo(
    () => ({
      ...classNames,
      fileDiffRow: {
        ...classNames?.fileDiffRow,
      },
    }),
    [classNames]
  );

  return (
    <div className="flex h-full min-h-0">
      {/* Heatmap sidebar */}
      {showHeatmapSidebar && (
        <HeatmapFileSidebar
          files={fileScores}
          threshold={threshold}
          onThresholdChange={handleThresholdChange}
          onFileClick={handleFileClick}
          selectedFile={selectedFile}
          isLoading={isHeatmapLoading}
          heatmapEnabled={heatmapEnabled}
          onHeatmapToggle={handleHeatmapToggle}
          className={cn("flex-shrink-0", classNames?.sidebar)}
          style={{ width: sidebarWidth }}
        />
      )}

      {/* Main diff viewer */}
      <div ref={diffContainerRef} className="flex-1 min-w-0 overflow-auto">
        <GitDiffViewer
          diffs={diffs}
          onControlsChange={onControlsChange}
          onFileToggle={onFileToggle}
          classNames={enhancedClassNames}
        />
      </div>
    </div>
  );
}

export const HeatmapDiffViewer = memo(HeatmapDiffViewerInner);
