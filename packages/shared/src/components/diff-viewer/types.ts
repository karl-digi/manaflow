import type { ReplaceDiffEntry } from "../../diff-types";

export type FileDiffRowClassNames = {
  button?: string;
  container?: string;
};

export type GitDiffViewerClassNames = {
  fileDiffRow?: FileDiffRowClassNames;
};

export interface GitDiffViewerControls {
  expandAll: () => void;
  collapseAll: () => void;
  totalAdditions: number;
  totalDeletions: number;
}

export interface GitDiffViewerProps {
  diffs: ReplaceDiffEntry[];
  onControlsChange?: (controls: GitDiffViewerControls) => void;
  classNames?: GitDiffViewerClassNames;
  onFileToggle?: (filePath: string, isExpanded: boolean) => void;
  theme?: "light" | "dark";
}
