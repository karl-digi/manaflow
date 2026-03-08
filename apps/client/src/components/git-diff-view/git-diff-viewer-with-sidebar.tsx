import type { DiffFileHighlighter } from "@git-diff-view/core";
import { DiffModeEnum } from "@git-diff-view/react";
import { Flame, PanelLeft, PanelLeftClose } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useTheme } from "@/components/theme/use-theme";

import { kitties } from "../kitties";
import { DiffSidebarFilter } from "../monaco/diff-sidebar-filter";
import {
  getDiffAnchorId,
  getHighlighter,
  prepareDiffFiles,
  shouldAutoCollapseFile,
} from "./adapter";
import { MemoDiffFileRow } from "./diff-file-row";
import type { GitDiffViewerWithSidebarProps } from "./types";

export const NewGitDiffViewerWithSidebar = memo(function NewGitDiffViewerWithSidebar({
  diffs,
  isLoading,
  onControlsChange,
  classNames,
  onFileToggle,
  isHeatmapActive,
  onToggleHeatmap,
}: GitDiffViewerWithSidebarProps) {
  const { theme } = useTheme();

  const kitty = useMemo(() => {
    return kitties[Math.floor(Math.random() * kitties.length)];
  }, []);

  const preparedFiles = useMemo(() => {
    return prepareDiffFiles(diffs, theme);
  }, [diffs, theme]);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => new Set());
  const [viewedFiles, setViewedFiles] = useState<Set<string>>(() => new Set());
  const [activePath, setActivePath] = useState<string>(() => diffs[0]?.filePath ?? "");

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

  useEffect(() => {
    const currentPaths = new Set(preparedFiles.map((file) => file.entry.filePath));

    setViewedFiles((previous) => {
      const next = new Set<string>();
      for (const path of previous) {
        if (currentPaths.has(path)) {
          next.add(path);
        }
      }
      return next;
    });

    setActivePath((previous) => {
      if (previous && currentPaths.has(previous)) {
        return previous;
      }
      return preparedFiles[0]?.entry.filePath ?? "";
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
        console.error("[git-diff-viewer-with-sidebar] Failed to load highlighter", error);
        if (!isCancelled) {
          setRegisterHighlighter(undefined);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return;
      }

      if (
        (event.key === "f" || event.key === "F") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setIsSidebarCollapsed((previous) => !previous);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
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
          console.error("[git-diff-viewer-with-sidebar] onFileToggle callback failed", error);
        }

        return next;
      });
    },
    [onFileToggle],
  );

  const handleToggleViewed = useCallback((filePath: string) => {
    setViewedFiles((previous) => {
      const next = new Set(previous);
      const wasViewed = next.has(filePath);

      if (wasViewed) {
        next.delete(filePath);
        setExpandedFiles((expanded) => {
          const updated = new Set(expanded);
          updated.add(filePath);
          return updated;
        });
      } else {
        next.add(filePath);
        setExpandedFiles((expanded) => {
          const updated = new Set(expanded);
          updated.delete(filePath);
          return updated;
        });
      }

      return next;
    });
  }, []);

  const handleSelectFile = useCallback((filePath: string) => {
    setActivePath(filePath);

    if (typeof window !== "undefined") {
      const anchorId = getDiffAnchorId(filePath);
      const element = document.getElementById(anchorId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, []);

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

  const controlsHandlerRef =
    useRef<GitDiffViewerWithSidebarProps["onControlsChange"]>(null);

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
      <div className="grow flex flex-col bg-white dark:bg-neutral-900 min-h-0">
        <div className="flex-shrink-0 flex items-center gap-2 px-2 py-1.5 border-b border-neutral-200/80 dark:border-neutral-800/70">
          <div className="flex items-center gap-1.5 px-2 py-1">
            <div className="w-4 h-4 bg-neutral-100 dark:bg-neutral-800 rounded animate-pulse" />
            <div className="w-10 h-4 bg-neutral-100 dark:bg-neutral-800 rounded animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-4 bg-neutral-100 dark:bg-neutral-800 rounded animate-pulse" />
            <div className="w-6 h-4 bg-neutral-100 dark:bg-neutral-800 rounded animate-pulse" />
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="w-[280px] h-full border-r border-neutral-200/80 dark:border-neutral-800/70">
            <div className="p-2">
              <div className="h-8 bg-neutral-100 dark:bg-neutral-800 rounded-md animate-pulse" />
            </div>
            <div className="space-y-0.5 px-2">
              {[1, 2, 3].map((row) => (
                <div key={row} className="flex items-center gap-2 px-2 py-1">
                  <div className="w-4 h-4 bg-neutral-100 dark:bg-neutral-800 rounded animate-pulse" />
                  <div className="h-4 bg-neutral-100 dark:bg-neutral-800 rounded flex-1 animate-pulse" />
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-col">
              {[1, 2].map((row) => (
                <div
                  key={row}
                  className="border-b border-neutral-200/80 dark:border-neutral-800/70"
                >
                  <div className="flex items-center gap-2 px-4 py-3">
                    <div className="w-4 h-4 bg-neutral-100 dark:bg-neutral-800 rounded animate-pulse" />
                    <div className="h-4 w-48 bg-neutral-100 dark:bg-neutral-800 rounded animate-pulse" />
                    <div className="ml-auto flex gap-2">
                      <div className="h-4 w-8 bg-neutral-100 dark:bg-neutral-800 rounded animate-pulse" />
                      <div className="h-4 w-8 bg-neutral-100 dark:bg-neutral-800 rounded animate-pulse" />
                    </div>
                  </div>
                  <div className="h-32 bg-neutral-50 dark:bg-neutral-900/50 animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (preparedFiles.length === 0) {
    return (
      <div className="grow flex flex-col bg-white dark:bg-neutral-900 min-h-0">
        <div className="px-2 py-1.5 flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-0.5 text-[13px] font-medium text-neutral-600 dark:text-neutral-400">
            <PanelLeft className="w-3.5 h-3.5" />
            <span>Files</span>
          </div>
        </div>
        <div className="grow flex flex-col items-center justify-center px-3 pb-3">
          <p className="text-xs text-neutral-500 dark:text-neutral-400 py-1">
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
    <div className="grow flex flex-col bg-white dark:bg-neutral-900 min-h-0">
      <div className="flex-shrink-0 flex items-center gap-2 px-2 py-1.5 border-b border-neutral-200/80 dark:border-neutral-800/70">
        <button
          type="button"
          onClick={() => setIsSidebarCollapsed((previous) => !previous)}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[13px] font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          title={isSidebarCollapsed ? "Show files (F)" : "Hide files (F)"}
        >
          {isSidebarCollapsed ? (
            <PanelLeft className="w-3.5 h-3.5" />
          ) : (
            <PanelLeftClose className="w-3.5 h-3.5" />
          )}
          <span>Files</span>
        </button>

        <div className="flex items-center gap-2 text-[11px] font-medium">
          <span className="text-green-600 dark:text-green-400">+{totalAdditions}</span>
          <span className="text-red-600 dark:text-red-400">−{totalDeletions}</span>
        </div>

        {onToggleHeatmap ? (
          <button
            type="button"
            onClick={onToggleHeatmap}
            className="flex items-center gap-1.5 text-[11px] font-medium ml-auto text-neutral-500 dark:text-neutral-400"
            title={
              isHeatmapActive
                ? "Switch to standard diff"
                : "Switch to heatmap diff"
            }
          >
            <Flame className="w-3 h-3" />
            <span>Diff Heatmap</span>
          </button>
        ) : null}
      </div>

      <div className="flex flex-1 min-h-0">
        {!isSidebarCollapsed ? (
          <div className="flex-shrink-0 self-stretch border-r border-neutral-200/80 dark:border-neutral-800/70">
            <DiffSidebarFilter
              diffs={diffs}
              viewedFiles={viewedFiles}
              activePath={activePath}
              onSelectFile={handleSelectFile}
              onToggleViewed={handleToggleViewed}
              className="sticky top-[var(--cmux-diff-header-offset,0px)] h-[calc(100vh-var(--cmux-diff-header-offset,0px)-41px)]"
            />
          </div>
        ) : null}

        <div className="flex-1 min-w-0">
          <div className="flex flex-col">
            {preparedFiles.map((prepared) => (
              <MemoDiffFileRow
                key={`git-diff:${prepared.entry.filePath}`}
                preparedFile={prepared}
                isExpanded={expandedFiles.has(prepared.entry.filePath)}
                isViewed={viewedFiles.has(prepared.entry.filePath)}
                onToggle={() => toggleFile(prepared.entry.filePath)}
                onToggleViewed={() => handleToggleViewed(prepared.entry.filePath)}
                theme={theme}
                mode={DiffModeEnum.SplitGitHub}
                classNames={classNames?.fileDiffRow}
                registerHighlighter={registerHighlighter}
                anchorId={getDiffAnchorId(prepared.entry.filePath)}
              />
            ))}

            <div className="px-3 py-6 text-center">
              <span className="select-none text-xs text-neutral-500 dark:text-neutral-400">
                You've reached the end of the diff!
              </span>
              <div className="grid place-content-center">
                <pre className="mt-2 pb-12 select-none text-left text-[8px] font-mono text-neutral-500 dark:text-neutral-400">
                  {kitty}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
