import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createTwoFilesPatch } from "diff";
import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";

import { Diff, Hunk } from "@/components/ui/diff";
import { parseDiff } from "@/components/ui/diff/utils";
import { cn } from "@/lib/utils";

import { FileDiffHeader } from "./file-diff-header";
import { kitties } from "./kitties";
import type { GitDiffViewerProps } from "./codemirror-git-diff-viewer";
export type { GitDiffViewerProps } from "./codemirror-git-diff-viewer";

type FileDiffRowClassNames = GitDiffViewerProps["classNames"] extends {
  fileDiffRow?: infer T;
}
  ? T
  : { button?: string; container?: string };

type DiffViewerError = {
  message: string;
};

const DiffViewer = memo(function DiffViewer({ diff }: { diff: string }) {
  const files = useMemo(() => {
    try {
      const diffResult = parseDiff(diff);
      console.log({ diff, diffResult });
      return diffResult;
    } catch (error) {
      console.error("[unified-git-diff-viewer] failed to parse diff", error);
      return [];
    }
  }, [diff]);

  if (files.length === 0) {
    return (
      <DiffUnavailable message="Unable to render this diff chunk." />
    );
  }

  return (
    <div className="space-y-6">
      {files.map((file, fileIndex) => (
        <Diff
          key={`${file.oldPath || file.newPath}:${fileIndex}`}
          fileName={file.newPath || file.oldPath}
          hunks={file.hunks}
          type={file.type}
          className="w-full"
        >
          {file.hunks.map((hunk, hunkIndex) => (
            <Hunk
              key={
                hunk.type === "hunk"
                  ? `${hunk.content}:${hunk.oldStart}:${hunk.newStart}`
                  : `skip-${hunk.content}-${hunk.count}-${hunkIndex}`
              }
              hunk={hunk}
            />
          ))}
        </Diff>
      ))}
    </div>
  );
});

DiffViewer.displayName = "DiffViewer";

function DiffUnavailable({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 px-3 py-4 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-300">
      {message}
    </div>
  );
}

interface FileDiffRowProps {
  file: ReplaceDiffEntry;
  isExpanded: boolean;
  onToggle: () => void;
  classNames?: FileDiffRowClassNames;
}

const FileDiffRow = memo(function FileDiffRow({
  file,
  isExpanded,
  onToggle,
  classNames,
}: FileDiffRowProps) {
  const { patch, error } = useMemo(() => buildPatch(file), [file]);

  let content: ReactNode = null;

  if (file.isBinary) {
    content = (
      <DiffUnavailable message="Binary files are not supported in the unified viewer yet." />
    );
  } else if (file.contentOmitted) {
    content = (
      <DiffUnavailable message="Diff omitted because the file is too large." />
    );
  } else if (error) {
    content = <DiffUnavailable message={error.message} />;
  } else if (!patch) {
    content = (
      <DiffUnavailable message="No diff content available for this file." />
    );
  } else {
    content = (
      <div className="overflow-x-auto bg-white">
        <DiffViewer diff={patch} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950",
        classNames?.container,
      )}
    >
      <FileDiffHeader
        filePath={file.filePath}
        oldPath={file.oldPath}
        status={file.status}
        additions={file.additions}
        deletions={file.deletions}
        isExpanded={isExpanded}
        onToggle={onToggle}
        className={classNames?.button}
      />
      {isExpanded ? (
        <div className="text-sm text-neutral-700 dark:text-neutral-200">
          {content}
        </div>
      ) : null}
    </div>
  );
});

FileDiffRow.displayName = "FileDiffRow";

type BuildPatchResult =
  | {
      patch: string;
      error?: undefined;
    }
  | {
      patch: null;
      error?: DiffViewerError;
    };

function buildPatch(entry: ReplaceDiffEntry): BuildPatchResult {
  if (entry.patch?.trim()) {
    return { patch: ensureGitPatchFormat(entry, entry.patch) };
  }

  if (
    entry.isBinary ||
    entry.contentOmitted ||
    (entry.oldContent === undefined && entry.newContent === undefined)
  ) {
    return { patch: null };
  }

  try {
    const patch = createTwoFilesPatch(
      entry.oldPath || entry.filePath,
      entry.filePath,
      entry.oldContent ?? "",
      entry.newContent ?? "",
    );
    const normalized = ensureGitPatchFormat(entry, patch);
    if (!normalized.trim()) {
      return { patch: null };
    }
    return { patch: normalized };
  } catch (error) {
    console.error("[unified-git-diff-viewer] failed to build patch", {
      filePath: entry.filePath,
      error,
    });
    return {
      patch: null,
      error: {
        message: "Unable to build diff for this file.",
      },
    };
  }
}

function ensureGitPatchFormat(
  entry: ReplaceDiffEntry,
  rawPatch: string,
): string {
  if (!rawPatch.trim()) {
    return rawPatch;
  }

  const trimmed = rawPatch.trimStart();
  if (trimmed.startsWith("diff --git")) {
    return rawPatch;
  }

  const normalizedOldPath = entry.oldPath ?? entry.filePath;
  const sanitizedLines = rawPatch
    .split(/\r?\n/)
    .filter((line, index) => {
      if (index === 0 && line.startsWith("Index:")) {
        return false;
      }
      if (index === 1 && line.startsWith("=")) {
        return false;
      }
      return true;
    });

  const hunkStartIndex = sanitizedLines.findIndex((line) =>
    line.startsWith("@@"),
  );
  const bodyLines =
    hunkStartIndex >= 0
      ? sanitizedLines.slice(hunkStartIndex)
      : sanitizedLines;

  const oldLabel =
    entry.status === "added" ? "/dev/null" : `a/${normalizedOldPath}`;
  const newLabel =
    entry.status === "deleted" ? "/dev/null" : `b/${entry.filePath}`;

  const headerLines = [`diff --git a/${normalizedOldPath} b/${entry.filePath}`];

  if (
    entry.status === "renamed" &&
    entry.oldPath &&
    entry.oldPath !== entry.filePath
  ) {
    headerLines.push(`rename from ${entry.oldPath}`);
    headerLines.push(`rename to ${entry.filePath}`);
  }

  headerLines.push(`--- ${oldLabel}`);
  headerLines.push(`+++ ${newLabel}`);

  return [...headerLines, ...bodyLines].join("\n");
}

export function UnifiedGitDiffViewer({
  diffs,
  onControlsChange,
  classNames,
  onFileToggle,
}: GitDiffViewerProps) {
  const kitty = useMemo(
    () => kitties[Math.floor(Math.random() * kitties.length)],
    [],
  );

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    () => new Set(diffs.map((diff) => diff.filePath)),
  );

  const fileGroups = useMemo(() => diffs ?? [], [diffs]);

  const totalAdditions = diffs.reduce((sum, diff) => sum + diff.additions, 0);
  const totalDeletions = diffs.reduce((sum, diff) => sum + diff.deletions, 0);

  const controlsHandlerRef = useRef<
    GitDiffViewerProps["onControlsChange"] | null
  >(null);

  useEffect(() => {
    controlsHandlerRef.current = onControlsChange ?? null;
  }, [onControlsChange]);

  const expandAll = useCallback(() => {
    setExpandedFiles(new Set(fileGroups.map((file) => file.filePath)));
  }, [fileGroups]);

  const collapseAll = useCallback(() => {
    setExpandedFiles(new Set());
  }, []);

  useEffect(() => {
    // controlsHandlerRef.current?.({
    //   expandAll,
    //   collapseAll,
    //   totalAdditions,
    //   totalDeletions,
    // });
  }, [expandAll, collapseAll, totalAdditions, totalDeletions]);

  const toggleFile = (filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      const isExpanded = next.has(filePath);
      if (isExpanded) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      try {
        onFileToggle?.(filePath, !isExpanded);
      } catch (error) {
        console.error("[unified-git-diff-viewer] file toggle failed", error);
      }
      return next;
    });
  };

  return (
    <div className="grow bg-white dark:bg-neutral-900">
      <div className="flex flex-col -space-y-px">
        {fileGroups.map((file) => (
          <FileDiffRow
            key={file.filePath}
            file={file}
            isExpanded={expandedFiles.has(file.filePath)}
            onToggle={() => toggleFile(file.filePath)}
            classNames={classNames?.fileDiffRow}
          />
        ))}
        <hr className="border-neutral-200 dark:border-neutral-800" />
        <div className="px-3 py-6 text-center">
          <span className="text-xs text-neutral-500 dark:text-neutral-400 select-none">
            You’ve reached the end of the diff!
          </span>
          <div className="grid place-content-center">
            <pre className="text-[8px] text-left text-neutral-500 dark:text-neutral-400 select-none mt-2 pb-20 font-mono">
              {kitty}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

UnifiedGitDiffViewer.displayName = "UnifiedGitDiffViewer";
