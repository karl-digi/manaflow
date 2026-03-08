import type { DiffFileHighlighter } from "@git-diff-view/core";
import { DiffModeEnum } from "@git-diff-view/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "@/components/theme/use-theme";

import { kitties } from "../kitties";
import { getHighlighter, prepareDiffFiles, shouldAutoCollapseFile } from "./adapter";
import { MemoDiffFileRow } from "./diff-file-row";
import type { GitDiffViewerProps } from "./types";

export type { GitDiffViewerProps } from "./types";

export const NewGitDiffViewer = memo(function NewGitDiffViewer({
  diffs,
  isLoading,
  onControlsChange,
  classNames,
  onFileToggle,
}: GitDiffViewerProps) {
  const { theme } = useTheme();

  const kitty = useMemo(() => {
    return kitties[Math.floor(Math.random() * kitties.length)];
  }, []);

  const preparedFiles = useMemo(() => {
    return prepareDiffFiles(diffs, theme);
  }, [diffs, theme]);

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => new Set());
  const initializedPathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setExpandedFiles((previous) => {
      const next = new Set<string>();
      const currentPaths = new Set<string>();

      for (const prepared of preparedFiles) {
        const filePath = prepared.entry.filePath;
        currentPaths.add(filePath);

        if (previous.has(filePath)) {
          next.add(filePath);
          continue;
        }

        if (!initializedPathsRef.current.has(filePath)) {
          if (!shouldAutoCollapseFile(prepared.totalLines, prepared.entry.status)) {
            next.add(filePath);
          }
        }
      }

      initializedPathsRef.current = currentPaths;

      // Avoid unnecessary re-renders when the set content hasn't changed
      if (
        next.size === previous.size &&
        [...next].every((path) => previous.has(path))
      ) {
        return previous;
      }
      return next;
    });
  }, [preparedFiles]);

  const [registerHighlighter, setRegisterHighlighter] =
    useState<DiffFileHighlighter>();

  useEffect(() => {
    let isCancelled = false;

    void getHighlighter()
      .then((highlighter) => {
        if (!isCancelled) {
          setRegisterHighlighter(highlighter);
        }
      })
      .catch((error) => {
        console.error("[git-diff-viewer] Failed to load highlighter", error);
        if (!isCancelled) {
          setRegisterHighlighter(undefined);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const toggleFile = useCallback(
    (filePath: string) => {
      setExpandedFiles((previous) => {
        const next = new Set(previous);
        const wasExpanded = next.has(filePath);

        if (wasExpanded) {
          next.delete(filePath);
        } else {
          next.add(filePath);
        }

        try {
          onFileToggle?.(filePath, !wasExpanded);
        } catch (error) {
          console.error("[git-diff-viewer] onFileToggle callback failed", error);
        }

        return next;
      });
    },
    [onFileToggle],
  );

  const expandAll = useCallback(() => {
    setExpandedFiles(new Set(preparedFiles.map((file) => file.entry.filePath)));
  }, [preparedFiles]);

  const collapseAll = useCallback(() => {
    setExpandedFiles(new Set());
  }, []);

  const totalAdditions = useMemo(() => {
    return diffs.reduce((sum, diff) => sum + diff.additions, 0);
  }, [diffs]);

  const totalDeletions = useMemo(() => {
    return diffs.reduce((sum, diff) => sum + diff.deletions, 0);
  }, [diffs]);

  const controlsHandlerRef = useRef<GitDiffViewerProps["onControlsChange"]>(null);

  useEffect(() => {
    controlsHandlerRef.current = onControlsChange;
  }, [onControlsChange]);

  useEffect(() => {
    controlsHandlerRef.current?.({
      expandAll,
      collapseAll,
      totalAdditions,
      totalDeletions,
    });
  }, [collapseAll, expandAll, totalAdditions, totalDeletions, diffs.length]);

  if (isLoading) {
    return (
      <div className="grid h-full place-content-center bg-white text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
        Loading diffs...
      </div>
    );
  }

  if (preparedFiles.length === 0) {
    return (
      <div className="grow bg-white dark:bg-neutral-900">
        <div className="grid grow place-content-center px-3 py-6 text-center">
          <p className="select-none text-xs text-neutral-500 dark:text-neutral-400">
            No diff detected
          </p>
          <pre className="mt-2 select-none text-left text-[8px] font-mono text-neutral-500 dark:text-neutral-400">
            {kitty}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="grow bg-white dark:bg-neutral-900">
      <div className="flex flex-col -space-y-px">
        {preparedFiles.map((prepared) => (
          <MemoDiffFileRow
            key={`git-diff:${prepared.entry.filePath}`}
            preparedFile={prepared}
            isExpanded={expandedFiles.has(prepared.entry.filePath)}
            onToggle={() => toggleFile(prepared.entry.filePath)}
            theme={theme}
            mode={DiffModeEnum.SplitGitHub}
            classNames={classNames?.fileDiffRow}
            registerHighlighter={registerHighlighter}
          />
        ))}

        <hr className="border-neutral-200 dark:border-neutral-800" />

        <div className="px-3 py-6 text-center">
          <span className="select-none text-xs text-neutral-500 dark:text-neutral-400">
            You've reached the end of the diff!
          </span>
          <div className="grid place-content-center">
            <pre className="mt-2 select-none pb-20 text-left text-[8px] font-mono text-neutral-500 dark:text-neutral-400">
              {kitty}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
});
