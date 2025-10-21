"use client";

import { useMemo } from "react";
import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";
import {
  MonacoGitDiffViewer,
  type GitDiffViewerProps,
} from "@cmux/shared/ui/diff";

const FILE_DIFF_ROW_CLASSNAMES: NonNullable<
  GitDiffViewerProps["classNames"]
> = {
  fileDiffRow: {
    button: "top-[88px] md:top-[72px] lg:top-[64px]",
  },
};

type PullRequestMonacoDiffViewerProps = {
  diffs: ReplaceDiffEntry[];
  className?: string;
};

export function PullRequestMonacoDiffViewer({
  diffs,
  className,
}: PullRequestMonacoDiffViewerProps) {
  const classNames = useMemo<GitDiffViewerProps["classNames"]>(() => {
    return FILE_DIFF_ROW_CLASSNAMES;
  }, []);

  return (
    <div className={className}>
      <MonacoGitDiffViewer diffs={diffs} theme="light" classNames={classNames} />
    </div>
  );
}
