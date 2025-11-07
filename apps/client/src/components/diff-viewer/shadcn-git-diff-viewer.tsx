"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createTwoFilesPatch } from "diff";
import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";

import { Diff, Hunk } from "@/components/ui/diff";
import { parseDiff, type File as ParsedDiffFile } from "@/components/ui/diff/utils";
import { cn } from "@/lib/utils";

import type { GitDiffViewerProps } from "../codemirror-git-diff-viewer";
export type { GitDiffViewerProps } from "../codemirror-git-diff-viewer";
import { FileDiffHeader } from "../file-diff-header";
import { kitties } from "../kitties";

type FileDiffRowClassNames = GitDiffViewerProps["classNames"] extends {
  fileDiffRow?: infer T;
}
  ? T
  : {
      button?: string;
      container?: string;
    };

type ViewerFile = ReplaceDiffEntry & {
  oldContent: string;
  newContent: string;
};

type ParsedPatchResult = {
  parsedFile: ParsedDiffFile | null;
  errorMessage: string | null;
};

function buildPatch(entry: ViewerFile): string | null {
  if (entry.patch && entry.patch.trim().length > 0) {
    return entry.patch;
  }

  if (entry.isBinary) {
    return null;
  }

  if (
    typeof entry.oldContent !== "string" &&
    typeof entry.newContent !== "string"
  ) {
    return null;
  }

  const fromPath = entry.oldPath ?? entry.filePath;
  const toPath = entry.filePath;
  try {
    return createTwoFilesPatch(
      fromPath,
      toPath,
      entry.oldContent ?? "",
      entry.newContent ?? "",
      fromPath,
      toPath,
      { context: 3 },
    );
  } catch (error) {
    console.error("[shadcn-git-diff-viewer] Failed to build patch", {
      filePath: entry.filePath,
      error,
    });
    return null;
  }
}

function parsePatch(entry: ViewerFile): ParsedPatchResult {
  const patch = buildPatch(entry);
  if (!patch) {
    return {
      parsedFile: null,
      errorMessage: entry.contentOmitted
        ? "Diff content was omitted because the file is too large."
        : "Diff content is unavailable for this file.",
    };
  }

  try {
    const [parsed] = parseDiff(patch);
    if (!parsed) {
      return {
        parsedFile: null,
        errorMessage: "Failed to parse diff content for this file.",
      };
    }
    return { parsedFile: parsed, errorMessage: null };
  } catch (error) {
    console.error("[shadcn-git-diff-viewer] Failed to parse patch", {
      filePath: entry.filePath,
      error,
    });
    return {
      parsedFile: null,
      errorMessage: "Failed to parse diff content for this file.",
    };
  }
}

function getDiffUnavailableMessage(entry: ViewerFile): string {
  if (entry.status === "deleted") {
    return "File was deleted.";
  }
  if (entry.status === "renamed") {
    return "File was renamed.";
  }
  if (entry.isBinary) {
    return "Binary file not shown.";
  }
  if (entry.contentOmitted) {
    return "Diff content was omitted because the file is too large.";
  }
  return "Diff content is unavailable for this file.";
}

function FileDiffRow({
  file,
  isExpanded,
  onToggle,
  classNames,
}: {
  file: ViewerFile;
  isExpanded: boolean;
  onToggle: () => void;
  classNames?: FileDiffRowClassNames;
}) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const { parsedFile, errorMessage } = useMemo(() => {
    if (
      !isExpanded ||
      file.status === "renamed" ||
      file.status === "deleted" ||
      file.isBinary
    ) {
      return { parsedFile: null, errorMessage: null };
    }
    return parsePatch(file);
  }, [
    isExpanded,
    file.filePath,
    file.oldPath,
    file.patch,
    file.oldContent,
    file.newContent,
    file.status,
    file.isBinary,
    file.contentOmitted,
  ]);

  useEffect(() => {
    if (!previewRef.current) {
      return;
    }
    if (!isExpanded) {
      previewRef.current.scrollTop = 0;
    }
  }, [isExpanded]);

  return (
    <div className={cn("bg-white dark:bg-neutral-900", classNames?.container)}>
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
      {isExpanded && (
        <div className="border-t border-neutral-100 dark:border-neutral-800">
          {file.status === "renamed" ? (
            <div className="px-3 py-6 text-center text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900/50 space-y-2">
              <p className="select-none">File was renamed.</p>
              {file.oldPath ? (
                <p className="font-mono text-[11px] text-neutral-600 dark:text-neutral-300 select-none">
                  {file.oldPath} → {file.filePath}
                </p>
              ) : null}
            </div>
          ) : file.isBinary ? (
            <div className="px-3 py-6 text-center text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900/50">
              Binary file not shown
            </div>
          ) : file.status === "deleted" ? (
            <div className="px-3 py-6 text-center text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900/50">
              File was deleted
            </div>
          ) : parsedFile ? (
            <div
              ref={previewRef}
              className="max-h-[70vh] overflow-auto bg-white dark:bg-neutral-950"
            >
              <Diff
                key={`${parsedFile.oldPath}:${parsedFile.newPath}:${file.filePath}`}
                fileName={parsedFile.newPath ?? file.filePath}
                hunks={parsedFile.hunks}
                type={parsedFile.type}
                className="w-full"
              >
                {parsedFile.hunks.map((hunk) => (
                  <Hunk key={hunk.content} hunk={hunk} />
                ))}
              </Diff>
            </div>
          ) : (
            <div className="px-3 py-6 text-center text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900/50">
              {errorMessage ?? getDiffUnavailableMessage(file)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MemoFileDiffRow = memo(FileDiffRow, (prev, next) => {
  const a = prev.file;
  const b = next.file;
  return (
    prev.isExpanded === next.isExpanded &&
    a.filePath === b.filePath &&
    a.oldPath === b.oldPath &&
    a.status === b.status &&
    a.additions === b.additions &&
    a.deletions === b.deletions &&
    a.isBinary === b.isBinary &&
    a.contentOmitted === b.contentOmitted &&
    (a.patch || "") === (b.patch || "") &&
    (a.oldContent || "") === (b.oldContent || "") &&
    (a.newContent || "") === (b.newContent || "")
  );
});

export function ShadcnGitDiffViewer({
  diffs,
  onControlsChange,
  classNames,
  onFileToggle,
}: GitDiffViewerProps) {
  const kitty = useMemo(
    () => kitties[Math.floor(Math.random() * kitties.length)],
    [],
  );

  const viewerFiles: ViewerFile[] = useMemo(
    () =>
      diffs.map((diff) => ({
        ...diff,
        oldContent: diff.oldContent ?? "",
        newContent: diff.newContent ?? "",
      })),
    [diffs],
  );

  const filePaths = useMemo(
    () => viewerFiles.map((file) => file.filePath),
    [viewerFiles],
  );

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(
    () => new Set(filePaths),
  );

  useEffect(() => {
    setExpandedFiles(new Set(filePaths));
  }, [filePaths]);

  const toggleFile = (filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      const wasExpanded = next.has(filePath);
      if (wasExpanded) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      try {
        onFileToggle?.(filePath, !wasExpanded);
      } catch {
        // no-op
      }
      return next;
    });
  };

  const expandAll = useCallback(() => {
    setExpandedFiles(new Set(filePaths));
  }, [filePaths]);
  const collapseAll = useCallback(() => {
    setExpandedFiles(new Set());
  }, []);

  const totalAdditions = diffs.reduce((sum, entry) => sum + entry.additions, 0);
  const totalDeletions = diffs.reduce((sum, entry) => sum + entry.deletions, 0);

  const controlsHandlerRef = useRef<
    | ((controls: {
        expandAll: () => void;
        collapseAll: () => void;
        totalAdditions: number;
        totalDeletions: number;
      }) => void)
    | null
  >(null);

  useEffect(() => {
    controlsHandlerRef.current = onControlsChange ?? null;
  }, [onControlsChange]);

  useEffect(() => {
    controlsHandlerRef.current?.({
      expandAll,
      collapseAll,
      totalAdditions,
      totalDeletions,
    });
  }, [expandAll, collapseAll, totalAdditions, totalDeletions]);

  return (
    <div className="grow bg-white dark:bg-neutral-900">
      <div className="flex flex-col -space-y-px">
        {viewerFiles.map((file) => (
          <MemoFileDiffRow
            key={`shadcn:${file.filePath}`}
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
