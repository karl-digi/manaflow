"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactElement, ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileEdit,
  FileMinus,
  FilePlus,
  FileText,
  Folder,
  Sparkles,
} from "lucide-react";
import { DiffView, DiffFile, DiffModeEnum } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";

import { api } from "@cmux/convex/api";
import { useConvexQuery } from "@convex-dev/react-query";
import type { FunctionReturnType } from "convex/server";
import type { GithubFileChange } from "@/lib/github/fetch-pull-request";
import { cn } from "@/lib/utils";

import {
  buildDiffHeatmap,
  parseReviewHeatmap,
  type DiffHeatmap,
  type ReviewHeatmapLine,
} from "./heatmap";

type PullRequestDiffViewerProps = {
  files: GithubFileChange[];
  teamSlugOrId: string;
  repoFullName: string;
  prNumber?: number | null;
  comparisonSlug?: string | null;
  jobType?: "pull_request" | "comparison";
  commitRef?: string;
  baseCommitRef?: string;
};

type ParsedFileDiff = {
  file: GithubFileChange;
  anchorId: string;
  diffFile: DiffFile | null;
  error?: string;
};

type FileOutput =
  | FunctionReturnType<typeof api.codeReview.listFileOutputsForPr>[number]
  | FunctionReturnType<typeof api.codeReview.listFileOutputsForComparison>[number];

type HeatmapTooltipMeta = {
  score: number;
  reason: string | null;
};

type FileDiffViewModel = {
  entry: ParsedFileDiff;
  review: FileOutput | null;
  reviewHeatmap: ReviewHeatmapLine[];
  diffHeatmap: DiffHeatmap | null;
};

type ReviewErrorTarget = {
  id: string;
  anchorId: string;
  filePath: string;
  lineNumber: number;
  reason: string | null;
  score: number | null;
};

type FocusNavigateOptions = {
  source?: "keyboard" | "pointer";
};

type ActiveTooltipTarget = {
  filePath: string;
  lineNumber: number;
};

type ShowAutoTooltipOptions = {
  sticky?: boolean;
};

type HeatmapTooltipTheme = {
  contentClass: string;
  titleClass: string;
  reasonClass: string;
};

const extensionToLanguage: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cmake: "cmake",
  coffee: "coffeescript",
  conf: "ini",
  cpp: "cpp",
  cjs: "javascript",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  dockerfile: "dockerfile",
  gql: "graphql",
  graphql: "graphql",
  h: "c",
  hh: "cpp",
  hpp: "cpp",
  htm: "markup",
  html: "markup",
  hxx: "cpp",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  json5: "json",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  m: "objectivec",
  md: "markdown",
  mdx: "markdown",
  mk: "makefile",
  mjs: "javascript",
  mm: "objectivec",
  php: "php",
  prisma: "prisma",
  ps1: "powershell",
  psm1: "powershell",
  py: "python",
  rs: "rust",
  rb: "ruby",
  sass: "scss",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svg: "markup",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",
  xml: "markup",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
  svelte: "svelte",
  go: "go",
  diff: "diff",
  env: "bash",
  lock: "yaml",
};

const filenameLanguageMap: Record<string, string> = {
  dockerfile: "dockerfile",
  "docker-compose.yml": "yaml",
  "cmakelists.txt": "cmake",
  makefile: "makefile",
  gitignore: "bash",
  env: "bash",
  "env.example": "bash",
  gemfile: "ruby",
  podfile: "ruby",
  brewfile: "ruby",
  "package-lock.json": "json",
  "yarn.lock": "yaml",
  "pnpm-lock.yaml": "yaml",
  "bun.lock": "toml",
};

function inferLanguage(filename: string): string | null {
  const lowerPath = filename.toLowerCase();
  const segments = lowerPath.split("/");
  const basename = segments[segments.length - 1] ?? lowerPath;

  if (filenameLanguageMap[lowerPath]) {
    return filenameLanguageMap[lowerPath];
  }

  if (filenameLanguageMap[basename]) {
    return filenameLanguageMap[basename];
  }

  const dotSegments = basename.split(".").filter(Boolean);

  for (let index = dotSegments.length - 1; index >= 0; index -= 1) {
    const part = dotSegments[index];
    const language = extensionToLanguage[part];
    if (language) {
      return language;
    }
  }

  return null;
}

type FileTreeNode = {
  name: string;
  path: string;
  children: FileTreeNode[];
  file?: GithubFileChange;
};

type FileStatusMeta = {
  icon: ReactElement;
  colorClassName: string;
  label: string;
};

function getFileStatusMeta(
  status: GithubFileChange["status"] | undefined
): FileStatusMeta {
  const iconClassName = "h-3.5 w-3.5";

  switch (status) {
    case "added":
      return {
        icon: <FilePlus className={iconClassName} />,
        colorClassName: "text-green-600 dark:text-green-400",
        label: "Added",
      };
    case "removed":
      return {
        icon: <FileMinus className={iconClassName} />,
        colorClassName: "text-red-600 dark:text-red-400",
        label: "Deleted",
      };
    case "modified":
      return {
        icon: <FileEdit className={iconClassName} />,
        colorClassName: "text-yellow-600 dark:text-yellow-400",
        label: "Modified",
      };
    case "renamed":
      return {
        icon: <FileCode className={iconClassName} />,
        colorClassName: "text-blue-600 dark:text-blue-400",
        label: "Renamed",
      };
    case "copied":
      return {
        icon: <FileText className={iconClassName} />,
        colorClassName: "text-purple-600 dark:text-purple-400",
        label: "Copied",
      };
    default:
      return {
        icon: <FileText className={iconClassName} />,
        colorClassName: "text-neutral-600 dark:text-neutral-400",
        label: "Changed",
      };
  }
}

function buildDiffText(file: GithubFileChange): string {
  const oldPath = file.previous_filename ?? file.filename;
  const newPath = file.filename;
  const deletions = file.deletions ?? 0;
  const additions = file.additions ?? 0;

  const headers = [
    `diff --git a/${oldPath} b/${newPath}`,
    `index 0000000..1111111 100644`,
    `--- a/${oldPath}`,
    `+++ b/${newPath}`,
  ];

  return [headers.join("\n"), file.patch || ""].join("\n");
}

function buildFileTree(files: GithubFileChange[]): FileTreeNode[] {
  const root: FileTreeNode = {
    name: "",
    path: "",
    children: [],
  };

  for (const file of files) {
    const segments = file.filename.split("/");
    let current = root;

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const isLastSegment = index === segments.length - 1;
      const path = segments.slice(0, index + 1).join("/");

      let child = current.children.find((node) => node.name === segment);

      if (!child) {
        child = {
          name: segment,
          path,
          children: [],
          ...(isLastSegment ? { file } : {}),
        };
        current.children.push(child);
      } else if (isLastSegment) {
        child.file = file;
      }

      current = child;
    }
  }

  const collapseNode = (node: FileTreeNode): FileTreeNode => {
    if (node.children.length === 0) {
      return node;
    }

    if (node.children.length === 1 && !node.file) {
      const child = node.children[0];
      const combinedName = node.name ? `${node.name}/${child.name}` : child.name;

      return collapseNode({
        name: combinedName,
        path: child.path,
        children: child.children,
        file: child.file,
      });
    }

    return {
      ...node,
      children: node.children.map((child) => collapseNode(child)),
    };
  };

  const collapsedChildren = root.children.map((child) => collapseNode(child));

  return collapsedChildren;
}

function collectDirectoryPaths(nodes: FileTreeNode[]): string[] {
  const directories: string[] = [];
  const stack = [...nodes];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }

    if (node.children.length === 0) {
      continue;
    }

    if (node.path) {
      directories.push(node.path);
    }

    stack.push(...node.children);
  }

  return directories;
}

function getParentPaths(path: string): string[] {
  if (!path) return [];
  const segments = path.split("/");
  const parents: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    parents.push(segments.slice(0, index).join("/"));
  }
  return parents;
}

export function PullRequestDiffViewer({
  files,
  teamSlugOrId,
  repoFullName,
  prNumber,
  comparisonSlug,
  jobType,
  commitRef,
  baseCommitRef,
}: PullRequestDiffViewerProps) {
  const normalizedJobType: "pull_request" | "comparison" =
    jobType ?? (comparisonSlug ? "comparison" : "pull_request");

  const prQueryArgs = useMemo(
    () =>
      normalizedJobType !== "pull_request" || prNumber === null || prNumber === undefined
        ? ("skip" as const)
        : {
            teamSlugOrId,
            repoFullName,
            prNumber,
            ...(commitRef ? { commitRef } : {}),
            ...(baseCommitRef ? { baseCommitRef } : {}),
          },
    [
      normalizedJobType,
      teamSlugOrId,
      repoFullName,
      prNumber,
      commitRef,
      baseCommitRef,
    ]
  );

  const comparisonQueryArgs = useMemo(
    () =>
      normalizedJobType !== "comparison" || !comparisonSlug
        ? ("skip" as const)
        : {
            teamSlugOrId,
            repoFullName,
            comparisonSlug,
            ...(commitRef ? { commitRef } : {}),
            ...(baseCommitRef ? { baseCommitRef } : {}),
          },
    [
      normalizedJobType,
      teamSlugOrId,
      repoFullName,
      comparisonSlug,
      commitRef,
      baseCommitRef,
    ]
  );

  const prFileOutputs = useConvexQuery(
    api.codeReview.listFileOutputsForPr,
    prQueryArgs
  );
  const comparisonFileOutputs = useConvexQuery(
    api.codeReview.listFileOutputsForComparison,
    comparisonQueryArgs
  );

  const fileOutputs =
    normalizedJobType === "comparison" ? comparisonFileOutputs : prFileOutputs;

  const fileOutputIndex = useMemo(() => {
    if (!fileOutputs) {
      return new Map<string, FileOutput>();
    }

    const map = new Map<string, FileOutput>();
    for (const output of fileOutputs) {
      map.set(output.filePath, output);
    }
    return map;
  }, [fileOutputs]);

  const totalFileCount = files.length;

  const processedFileCount = useMemo(() => {
    if (fileOutputs === undefined) {
      return null;
    }

    let count = 0;
    for (const file of files) {
      if (fileOutputIndex.has(file.filename)) {
        count += 1;
      }
    }

    return count;
  }, [fileOutputs, fileOutputIndex, files]);

  const isLoadingFileOutputs = fileOutputs === undefined;

  const parsedDiffs = useMemo<ParsedFileDiff[]>(() => {
    return files.map((file) => {
      if (!file.patch) {
        return {
          file,
          anchorId: file.filename,
          diffFile: null,
          error:
            "GitHub did not return a textual diff for this file. It may be binary or too large.",
        };
      }

      try {
        const oldPath = file.previous_filename ?? file.filename;
        const newPath = file.filename;
        const language = inferLanguage(newPath);

        // Parse the hunks from the patch
        const hunks = file.patch.split("\n");

        const diffFile = new DiffFile(
          oldPath,
          "", // oldFile content - we don't have full content, just patch
          newPath,
          "", // newFile content - we don't have full content, just patch
          hunks,
          language || undefined,
          language || undefined
        );

        diffFile.initRaw();

        return {
          file,
          anchorId: file.filename,
          diffFile,
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to parse GitHub patch payload.";
        return {
          file,
          anchorId: file.filename,
          diffFile: null,
          error: message,
        };
      }
    });
  }, [files]);

  const fileEntries = useMemo<FileDiffViewModel[]>(() => {
    return parsedDiffs.map((entry) => {
      const review = fileOutputIndex.get(entry.file.filename) ?? null;
      const reviewHeatmap = review
        ? parseReviewHeatmap(review.codexReviewOutput)
        : [];

      // Note: diffHeatmap integration would require mapping to git-diff-view's structure
      // For now, we'll pass null and can enhance this later
      const diffHeatmap = null;

      return {
        entry,
        review,
        reviewHeatmap,
        diffHeatmap,
      };
    });
  }, [parsedDiffs, fileOutputIndex]);

  const reviewErrorTargets = useMemo<ReviewErrorTarget[]>(() => {
    const targets: ReviewErrorTarget[] = [];

    for (const viewModel of fileEntries) {
      const { entry, reviewHeatmap } = viewModel;

      for (const heatmapLine of reviewHeatmap) {
        if (
          heatmapLine.score !== null &&
          heatmapLine.score >= 0.8 &&
          heatmapLine.lineNumber !== null
        ) {
          targets.push({
            id: `${entry.anchorId}:${heatmapLine.lineNumber}`,
            anchorId: entry.anchorId,
            filePath: entry.file.filename,
            lineNumber: heatmapLine.lineNumber,
            reason: heatmapLine.reason,
            score: heatmapLine.score,
          });
        }
      }
    }

    return targets;
  }, [fileEntries]);

  const [focusedErrorIndex, setFocusedErrorIndex] = useState<number>(-1);

  const focusError = useCallback(
    (index: number, _options?: FocusNavigateOptions) => {
      if (index < 0 || index >= reviewErrorTargets.length) {
        return;
      }

      const target = reviewErrorTargets[index];
      if (!target) {
        return;
      }

      setFocusedErrorIndex(index);

      const anchorElement = document.getElementById(target.anchorId);
      if (anchorElement) {
        anchorElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    },
    [reviewErrorTargets]
  );

  const focusNextError = useCallback(
    (options?: FocusNavigateOptions) => {
      if (reviewErrorTargets.length === 0) {
        return;
      }

      const nextIndex =
        focusedErrorIndex === -1 || focusedErrorIndex >= reviewErrorTargets.length - 1
          ? 0
          : focusedErrorIndex + 1;

      focusError(nextIndex, options);
    },
    [focusedErrorIndex, reviewErrorTargets.length, focusError]
  );

  const focusPreviousError = useCallback(
    (options?: FocusNavigateOptions) => {
      if (reviewErrorTargets.length === 0) {
        return;
      }

      const previousIndex =
        focusedErrorIndex === -1 || focusedErrorIndex === 0
          ? reviewErrorTargets.length - 1
          : focusedErrorIndex - 1;

      focusError(previousIndex, options);
    },
    [focusedErrorIndex, reviewErrorTargets.length, focusError]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "J" && event.shiftKey) {
        event.preventDefault();
        focusNextError({ source: "keyboard" });
      } else if (event.key === "K" && event.shiftKey) {
        event.preventDefault();
        focusPreviousError({ source: "keyboard" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [focusNextError, focusPreviousError]);

  const fileTree = useMemo(() => buildFileTree(files), [files]);

  const allDirectoryPaths = useMemo(
    () => collectDirectoryPaths(fileTree),
    [fileTree]
  );

  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(
    () => new Set()
  );

  const toggleDirectory = useCallback((path: string) => {
    setCollapsedDirectories((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setCollapsedDirectories(new Set());
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedDirectories(new Set(allDirectoryPaths));
  }, [allDirectoryPaths]);

  const scrollToFile = useCallback((filename: string) => {
    const element = document.getElementById(filename);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const renderFileTreeNode = useCallback(
    (node: FileTreeNode, depth: number = 0): ReactNode => {
      const isDirectory = node.children.length > 0;
      const isCollapsed = collapsedDirectories.has(node.path);

      if (isDirectory) {
        return (
          <Fragment key={node.path}>
            <button
              onClick={() => toggleDirectory(node.path)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4 flex-shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 flex-shrink-0" />
              )}
              <Folder className="h-4 w-4 flex-shrink-0 text-neutral-500" />
              <span className="truncate">{node.name}</span>
            </button>
            {!isCollapsed &&
              node.children.map((child) => renderFileTreeNode(child, depth + 1))}
          </Fragment>
        );
      }

      if (!node.file) {
        return null;
      }

      const statusMeta = getFileStatusMeta(node.file.status);

      return (
        <button
          key={node.path}
          onClick={() => scrollToFile(node.file!.filename)}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className={cn("flex-shrink-0", statusMeta.colorClassName)}>
            {statusMeta.icon}
          </span>
          <span className="truncate">{node.name}</span>
        </button>
      );
    },
    [collapsedDirectories, toggleDirectory, scrollToFile]
  );

  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const updateTheme = () => {
      const isDark = document.documentElement.classList.contains("dark");
      setTheme(isDark ? "dark" : "light");
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex h-full">
      {/* File tree sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-neutral-200 dark:border-neutral-800">
        <div className="sticky top-0 border-b border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">
              Files changed ({totalFileCount})
            </span>
            {isLoadingFileOutputs && (
              <span className="text-xs text-neutral-500">Loading reviews...</span>
            )}
            {!isLoadingFileOutputs && processedFileCount !== null && (
              <span className="text-xs text-neutral-500">
                {processedFileCount}/{totalFileCount} reviewed
              </span>
            )}
          </div>
          <div className="flex gap-1">
            <button
              onClick={expandAll}
              className="rounded px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Expand all
            </button>
            <button
              onClick={collapseAll}
              className="rounded px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Collapse all
            </button>
          </div>
          {reviewErrorTargets.length > 0 && (
            <div className="mt-2 flex items-center gap-2 rounded border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-900">
              <Sparkles className="h-4 w-4 text-yellow-500" />
              <span className="text-xs">
                {reviewErrorTargets.length} issue{reviewErrorTargets.length !== 1 ? "s" : ""} found
              </span>
              <button
                onClick={() => focusNextError()}
                className="ml-auto rounded px-2 py-0.5 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-800"
              >
                Navigate (Shift+J/K)
              </button>
            </div>
          )}
        </div>
        <div className="overflow-y-auto p-2">
          {fileTree.map((node) => renderFileTreeNode(node))}
        </div>
      </div>

      {/* Diff viewer */}
      <div className="flex-1 overflow-y-auto">
        {fileEntries.map((viewModel) => {
          const { entry, review } = viewModel;
          const statusMeta = getFileStatusMeta(entry.file.status);

          return (
            <div
              key={entry.file.filename}
              id={entry.anchorId}
              className="border-b border-neutral-200 dark:border-neutral-800"
            >
              {/* File header */}
              <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={statusMeta.colorClassName}>
                      {statusMeta.icon}
                    </span>
                    <span className="font-mono text-sm font-medium">
                      {entry.file.filename}
                    </span>
                    {entry.file.previous_filename &&
                      entry.file.previous_filename !== entry.file.filename && (
                        <span className="text-xs text-neutral-500">
                          (renamed from {entry.file.previous_filename})
                        </span>
                      )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-neutral-500">
                    <span className="text-green-600 dark:text-green-400">
                      +{entry.file.additions ?? 0}
                    </span>
                    <span className="text-red-600 dark:text-red-400">
                      -{entry.file.deletions ?? 0}
                    </span>
                  </div>
                </div>
                {review && (
                  <div className="mt-2 flex items-start gap-2 rounded border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-yellow-500" />
                    <div className="flex-1">
                      <div className="font-medium">AI Review</div>
                      {review.codexReviewOutput && (
                        <div className="mt-1 text-neutral-600 dark:text-neutral-400">
                          {JSON.stringify(review.codexReviewOutput).substring(0, 150)}...
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Diff content */}
              <div className="bg-white dark:bg-neutral-950">
                {entry.error && (
                  <div className="p-4 text-sm text-neutral-500">{entry.error}</div>
                )}
                {entry.diffFile && (
                  <DiffView
                    diffFile={entry.diffFile}
                    diffViewMode={DiffModeEnum.Split}
                    diffViewTheme={theme}
                    diffViewHighlight={true}
                    diffViewWrap={false}
                    diffViewFontSize={13}
                  />
                )}
              </div>
            </div>
          );
        })}

        {fileEntries.length === 0 && (
          <div className="flex h-full items-center justify-center p-8 text-neutral-500">
            No file changes to display
          </div>
        )}
      </div>
    </div>
  );
}
