import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";
import type { DiffFile } from "@git-diff-view/core";

export type FileDiffRowClassNames = {
  button?: string;
  container?: string;
};

export type GitDiffViewerClassNames = {
  fileDiffRow?: FileDiffRowClassNames;
};

export interface PreparedDiffFile {
  entry: ReplaceDiffEntry;
  diffFile: DiffFile | null;
  language: string;
  totalLines: number;
}

export interface GitDiffViewerProps {
  diffs: ReplaceDiffEntry[];
  isLoading?: boolean;
  onControlsChange?: (controls: {
    expandAll: () => void;
    collapseAll: () => void;
    totalAdditions: number;
    totalDeletions: number;
  }) => void;
  classNames?: GitDiffViewerClassNames;
  onFileToggle?: (filePath: string, isExpanded: boolean) => void;
}

export interface GitDiffViewerWithSidebarProps extends GitDiffViewerProps {
  isHeatmapActive?: boolean;
  onToggleHeatmap?: () => void;
}

export const AUTO_COLLAPSE_THRESHOLD = Infinity;
export const LARGE_DIFF_THRESHOLD = 100;
export const MAX_LINES_FOR_SYNTAX = 5000;
export const VIEWPORT_RENDER_MARGIN = "200px";

// Line-level lazy loading constants
export const INITIAL_VISIBLE_LINES = 100;
export const CHUNK_SIZE = 100;
export const LINE_HEIGHT_ESTIMATE = 24; // px - includes line content + padding
