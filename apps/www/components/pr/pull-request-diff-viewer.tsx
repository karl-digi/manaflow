"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactElement } from "react";
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

import {
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

type FileTreeNode = {
  name: string;
  path: string;
  children: FileTreeNode[];
  parsedDiff?: ParsedFileDiff;
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

function getLanguageFromFilename(filename: string): string {
  const lowerFilename = filename.toLowerCase();
  const basename = lowerFilename.split("/").pop() ?? "";

  if (filenameLanguageMap[basename]) {
    return filenameLanguageMap[basename];
  }

  const ext = basename.split(".").pop() ?? "";
  return extensionToLanguage[ext] ?? "plaintext";
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
        const oldName = file.previous_filename ?? file.filename;
        const newName = file.filename;
        const lang = getLanguageFromFilename(newName);

        const diffFile = new DiffFile(
          oldName,
          "",
          newName,
          "",
          [file.patch],
          lang,
          lang
        );

        diffFile.init();
        diffFile.buildSplitDiffLines();
        diffFile.buildUnifiedDiffLines();

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

      // Build heatmap from parsed diff (we'll need to adapt this)
      const diffHeatmap = null; // TODO: Adapt heatmap logic for git-diff-view

      return {
        entry,
        review,
        reviewHeatmap,
        diffHeatmap,
      };
    });
  }, [parsedDiffs, fileOutputIndex]);

  const errorTargets = useMemo<ReviewErrorTarget[]>(() => {
    const targets: ReviewErrorTarget[] = [];

    for (const fileEntry of fileEntries) {
      const { entry, diffHeatmap } = fileEntry;
      if (!diffHeatmap || diffHeatmap.entries.size === 0) {
        continue;
      }

      const sortedEntries = Array.from(diffHeatmap.entries.entries()).sort(
        (a, b) => a[0] - b[0]
      );

      for (const [lineNumber, metadata] of sortedEntries) {
        targets.push({
          id: `${entry.anchorId}:${lineNumber}`,
          anchorId: entry.anchorId,
          filePath: entry.file.filename,
          lineNumber,
          reason: metadata.reason ?? null,
          score: metadata.score ?? null,
        });
      }
    }

    return targets;
  }, [fileEntries]);

  const targetCount = errorTargets.length;

  const [focusedErrorIndex, setFocusedErrorIndex] = useState<number | null>(
    null
  );

  const scrollToTarget = useCallback(
    (anchorId: string, _lineNumber: number) => {
      const elementId = `file-${anchorId}`;
      const element = document.getElementById(elementId);

      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    []
  );

  const goToNextError = useCallback(() => {
    if (targetCount === 0) {
      return;
    }

    const nextIndex =
      focusedErrorIndex === null || focusedErrorIndex >= targetCount - 1
        ? 0
        : focusedErrorIndex + 1;

    setFocusedErrorIndex(nextIndex);
    const target = errorTargets[nextIndex];
    if (target) {
      scrollToTarget(target.anchorId, target.lineNumber);
    }
  }, [targetCount, focusedErrorIndex, errorTargets, scrollToTarget]);

  const goToPrevError = useCallback(() => {
    if (targetCount === 0) {
      return;
    }

    const prevIndex =
      focusedErrorIndex === null || focusedErrorIndex <= 0
        ? targetCount - 1
        : focusedErrorIndex - 1;

    setFocusedErrorIndex(prevIndex);
    const target = errorTargets[prevIndex];
    if (target) {
      scrollToTarget(target.anchorId, target.lineNumber);
    }
  }, [targetCount, focusedErrorIndex, errorTargets, scrollToTarget]);

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === "J" || e.key === "j")) {
        e.preventDefault();
        goToNextError();
      } else if (e.shiftKey && (e.key === "K" || e.key === "k")) {
        e.preventDefault();
        goToPrevError();
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("keydown", handleKeydown);
      return () => {
        window.removeEventListener("keydown", handleKeydown);
      };
    }
  }, [goToNextError, goToPrevError]);

  const fileTree = useMemo(() => {
    return buildFileTree(parsedDiffs);
  }, [parsedDiffs]);

  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(
    () => new Set<string>()
  );
  const [visibleFiles, setVisibleFiles] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const file of files) {
      set.add(file.filename);
    }
    return set;
  });

  useEffect(() => {
    const newVisibleFiles = new Set<string>();
    for (const file of files) {
      const parentPaths = getParentPaths(file.filename);
      const hasCollapsedParent = parentPaths.some((p) =>
        collapsedDirectories.has(p)
      );
      if (!hasCollapsedParent) {
        newVisibleFiles.add(file.filename);
      }
    }
    setVisibleFiles(newVisibleFiles);
  }, [files, collapsedDirectories]);

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

  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(
    new Set<string>()
  );

  const toggleFileCollapse = useCallback((filename: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  }, []);

  const renderFileStatusIcon = (status: string | undefined) => {
    switch (status) {
      case "added":
        return <FilePlus className="h-4 w-4 text-green-500" />;
      case "removed":
        return <FileMinus className="h-4 w-4 text-red-500" />;
      case "modified":
        return <FileEdit className="h-4 w-4 text-blue-500" />;
      case "renamed":
        return <FileCode className="h-4 w-4 text-yellow-500" />;
      case "copied":
        return <FileText className="h-4 w-4 text-purple-500" />;
      default:
        return <FileCode className="h-4 w-4 text-neutral-500" />;
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* File tree sidebar */}
      <div className="w-80 overflow-y-auto border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Files Changed
            </h3>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {totalFileCount}
            </span>
          </div>
          {isLoadingFileOutputs && (
            <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              Loading review results...
            </div>
          )}
          {!isLoadingFileOutputs && processedFileCount !== null && (
            <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              {processedFileCount} / {totalFileCount} reviewed
            </div>
          )}
          {targetCount > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={goToPrevError}
                className="rounded bg-neutral-100 px-2 py-1 text-xs hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                type="button"
              >
                ← Prev (Shift+K)
              </button>
              <button
                onClick={goToNextError}
                className="rounded bg-neutral-100 px-2 py-1 text-xs hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                type="button"
              >
                Next → (Shift+J)
              </button>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {focusedErrorIndex !== null ? focusedErrorIndex + 1 : "-"} /{" "}
                {targetCount}
              </span>
            </div>
          )}
        </div>

        <div className="py-2">
          <FileTreeView
            nodes={fileTree}
            collapsedDirectories={collapsedDirectories}
            toggleDirectory={toggleDirectory}
            fileOutputIndex={fileOutputIndex}
            renderFileStatusIcon={renderFileStatusIcon}
          />
        </div>
      </div>

      {/* Diff view */}
      <div className="flex-1 overflow-y-auto">
        {parsedDiffs.map((parsed) => {
          const isVisible = visibleFiles.has(parsed.file.filename);
          if (!isVisible) {
            return null;
          }

          const isCollapsed = collapsedFiles.has(parsed.file.filename);
          const fileOutput = fileOutputIndex.get(parsed.file.filename);

          return (
            <div
              key={parsed.file.filename}
              id={`file-${parsed.anchorId}`}
              className="border-b border-neutral-200 dark:border-neutral-800"
            >
              {/* File header */}
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleFileCollapse(parsed.file.filename)}
                    className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                    type="button"
                    aria-label={isCollapsed ? "Expand" : "Collapse"}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                  {renderFileStatusIcon(parsed.file.status)}
                  <span className="text-sm font-mono text-neutral-900 dark:text-neutral-100">
                    {parsed.file.filename}
                  </span>
                  {parsed.file.previous_filename &&
                    parsed.file.previous_filename !== parsed.file.filename && (
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">
                        (renamed from {parsed.file.previous_filename})
                      </span>
                    )}
                </div>
                {fileOutput && (
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-blue-500" />
                    <span className="text-xs text-neutral-600 dark:text-neutral-300">
                      Reviewed
                    </span>
                  </div>
                )}
              </div>

              {/* Diff content */}
              {!isCollapsed && (
                <div className="bg-white dark:bg-neutral-950">
                  {parsed.error ? (
                    <div className="p-4 text-sm text-red-500">{parsed.error}</div>
                  ) : parsed.diffFile ? (
                    <DiffView
                      diffFile={parsed.diffFile}
                      diffViewMode={DiffModeEnum.Split}
                      diffViewHighlight={true}
                      diffViewWrap={false}
                      diffViewTheme="light"
                      className="font-mono text-xs"
                    />
                  ) : (
                    <div className="p-4 text-sm text-neutral-500">
                      No changes to display
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FileTreeView({
  nodes,
  collapsedDirectories,
  toggleDirectory,
  fileOutputIndex,
  renderFileStatusIcon,
  depth = 0,
}: {
  nodes: FileTreeNode[];
  collapsedDirectories: Set<string>;
  toggleDirectory: (path: string) => void;
  fileOutputIndex: Map<string, FileOutput>;
  renderFileStatusIcon: (status: string | undefined) => ReactElement;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isDirectory = node.children.length > 0;
        const isCollapsed = collapsedDirectories.has(node.path);

        if (isDirectory) {
          return (
            <div key={node.path}>
              <button
                onClick={() => toggleDirectory(node.path)}
                className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
                style={{ paddingLeft: `${depth * 12 + 16}px` }}
                type="button"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                <Folder className="h-4 w-4 text-neutral-500" />
                <span className="text-neutral-900 dark:text-neutral-100">
                  {node.name}
                </span>
              </button>
              {!isCollapsed && (
                <FileTreeView
                  nodes={node.children}
                  collapsedDirectories={collapsedDirectories}
                  toggleDirectory={toggleDirectory}
                  fileOutputIndex={fileOutputIndex}
                  renderFileStatusIcon={renderFileStatusIcon}
                  depth={depth + 1}
                />
              )}
            </div>
          );
        }

        if (!node.parsedDiff) {
          return null;
        }

        const hasReview = fileOutputIndex.has(node.parsedDiff.file.filename);

        return (
          <a
            key={node.path}
            href={`#file-${node.parsedDiff.anchorId}`}
            className="flex items-center gap-2 px-4 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
            style={{ paddingLeft: `${depth * 12 + 16}px` }}
          >
            {renderFileStatusIcon(node.parsedDiff.file.status)}
            <span className="flex-1 truncate text-neutral-900 dark:text-neutral-100">
              {node.name}
            </span>
            {hasReview && <Sparkles className="h-3 w-3 text-blue-500" />}
          </a>
        );
      })}
    </>
  );
}

function buildFileTree(parsedDiffs: ParsedFileDiff[]): FileTreeNode[] {
  const root: FileTreeNode = { name: "", path: "", children: [] };

  for (const parsed of parsedDiffs) {
    const parts = parsed.file.filename.split("/");
    let current = root;

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!part) {
        continue;
      }

      const isLastPart = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join("/");

      let child = current.children.find((c) => c.name === part);

      if (!child) {
        child = {
          name: part,
          path,
          children: [],
          ...(isLastPart ? { parsedDiff: parsed } : {}),
        };
        current.children.push(child);
      }

      current = child;
    }
  }

  return collapseTree(root.children);
}

function collapseTree(nodes: FileTreeNode[]): FileTreeNode[] {
  const root: FileTreeNode = {
    name: "",
    path: "",
    children: nodes,
  };

  const collapseNode = (node: FileTreeNode): FileTreeNode => {
    if (node.children.length !== 1 || node.parsedDiff) {
      return {
        ...node,
        children: node.children.map((child) => collapseNode(child)),
      };
    }

    const child = node.children[0];
    if (!child) {
      return node;
    }

    if (child.children.length === 0) {
      return {
        ...node,
        children: node.children.map((child) => collapseNode(child)),
      };
    }

    const collapsed = collapseNode(child);
    return {
      ...collapsed,
      name: `${node.name}/${collapsed.name}`,
      path: collapsed.path,
    };
  };

  const current = root;
  if (current.children.length === 1 && !current.parsedDiff) {
    const child = current.children[0];
    if (child && child.children.length > 0) {
      return [collapseNode(child)];
    }
  }

  if (current.children.length === 0) {
    return [];
  }

  return current.children.map((child) => collapseNode(child));
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
