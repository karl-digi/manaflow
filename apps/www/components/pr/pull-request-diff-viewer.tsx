"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { DiffView, DiffModeEnum, DiffFile } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";

import { api } from "@cmux/convex/api";
import { useConvexQuery } from "@convex-dev/react-query";
import type { FunctionReturnType } from "convex/server";
import type { GithubFileChange } from "@/lib/github/fetch-pull-request";
import { cn } from "@/lib/utils";
import {
  TooltipProvider,
} from "@/components/ui/tooltip";

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
  hunks: string[];
  error?: string;
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


type HeatmapTooltipTheme = {
  contentClass: string;
  titleClass: string;
  reasonClass: string;
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
        colorClassName: "text-emerald-600",
        label: "Added file",
      };
    case "removed":
      return {
        icon: <FileMinus className={iconClassName} />,
        colorClassName: "text-rose-600",
        label: "Removed file",
      };
    case "modified":
    case "changed":
      return {
        icon: <FileEdit className={iconClassName} />,
        colorClassName: "text-amber-600",
        label: "Modified file",
      };
    case "renamed":
      return {
        icon: <FileCode className={iconClassName} />,
        colorClassName: "text-sky-600",
        label: "Renamed file",
      };
    case "copied":
      return {
        icon: <FileCode className={iconClassName} />,
        colorClassName: "text-sky-600",
        label: "Copied file",
      };
    default:
      return {
        icon: <FileText className={iconClassName} />,
        colorClassName: "text-neutral-500",
        label: "File change",
      };
  }
}

export function PullRequestDiffViewer({
  files,
  teamSlugOrId,
  repoFullName,
  prNumber,
  comparisonSlug,
  jobType,
}: PullRequestDiffViewerProps) {
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const parsedEntries = useMemo<ParsedFileDiff[]>(() => {
    return files.map((file, index) => {
      const anchorId = `file-${index}-${file.filename.replace(/[^a-z0-9]/gi, "-")}`;
      const hunks: string[] = [];

      if (!file.patch) {
        return {
          file,
          anchorId,
          diffFile: null,
          hunks: [],
          error: "No patch data available",
        };
      }

      try {
        // Split patch into hunks
        const patchLines = file.patch.split("\n");
        hunks.push(...patchLines.filter((line) => line.startsWith("@@")));

        const language = inferLanguage(file.filename);
        const oldFileName = file.previous_filename || file.filename;
        const newFileName = file.filename;

        // Create DiffFile instance from hunks
        const diffFile = new DiffFile(
          oldFileName,
          "", // oldFile content - git-diff-view will parse from hunks
          newFileName,
          "", // newFile content - git-diff-view will parse from hunks
          hunks,
          language || undefined,
          language || undefined
        );

        // Initialize the diff file
        diffFile.initTheme(theme);
        diffFile.init();
        diffFile.buildSplitDiffLines();
        diffFile.buildUnifiedDiffLines();

        return {
          file,
          anchorId,
          diffFile,
          hunks,
        };
      } catch (error) {
        return {
          file,
          anchorId,
          diffFile: null,
          hunks: [],
          error:
            error instanceof Error
              ? error.message
              : "Failed to parse diff",
        };
      }
    });
  }, [files, theme]);

  const prOutputsResult = useConvexQuery(
    api.codeReview.listFileOutputsForPr,
    jobType === "pull_request" && prNumber
      ? { teamSlugOrId, repoFullName, prNumber }
      : "skip"
  );

  const comparisonOutputsResult = useConvexQuery(
    api.codeReview.listFileOutputsForComparison,
    jobType === "comparison" && comparisonSlug
      ? { teamSlugOrId, repoFullName, comparisonSlug }
      : "skip"
  );

  const fileOutputs = (jobType === "pull_request"
    ? prOutputsResult
    : comparisonOutputsResult) as FileOutput[] | undefined;

  const viewModels = useMemo<FileDiffViewModel[]>(() => {
    return parsedEntries.map((entry) => {
      const review =
        fileOutputs?.find((output: FileOutput) => output.filePath === entry.file.filename) ??
        null;
      const reviewHeatmap = review
        ? parseReviewHeatmap(review.codexReviewOutput)
        : [];
      const diffHeatmap = reviewHeatmap.length > 0
        ? buildDiffHeatmap(reviewHeatmap)
        : null;

      return {
        entry,
        review,
        reviewHeatmap,
        diffHeatmap,
      };
    });
  }, [parsedEntries, fileOutputs]);

  const fileTree = useMemo<FileTreeNode>(() => {
    const root: FileTreeNode = {
      name: "",
      path: "",
      children: [],
    };

    for (const file of files) {
      const parts = file.filename.split("/");
      let current = root;

      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        const isLeaf = index === parts.length - 1;
        const path = parts.slice(0, index + 1).join("/");

        let child = current.children.find((node) => node.name === part);
        if (!child) {
          child = {
            name: part,
            path,
            children: [],
            file: isLeaf ? file : undefined,
          };
          current.children.push(child);
        }

        current = child;
      }
    }

    return root;
  }, [files]);

  const handleSelectFile = useCallback((path: string) => {
    setSelectedFilePath(path);
    const fileIndex = files.findIndex((file) => file.filename === path);
    if (fileIndex >= 0) {
      const anchorId = `file-${fileIndex}-${path.replace(/[^a-z0-9]/gi, "-")}`;
      const element = document.getElementById(anchorId);
      element?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [files]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    setTheme(mediaQuery.matches ? "dark" : "light");

    const handleChange = (event: MediaQueryListEvent) => {
      setTheme(event.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return (
    <div className="flex h-full gap-4 overflow-hidden">
      <aside className="w-72 shrink-0 overflow-auto border-r border-neutral-200 bg-white p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Files changed
        </div>
        <FileTreeNavigator
          root={fileTree}
          selectedPath={selectedFilePath}
          onSelectFile={handleSelectFile}
        />
      </aside>

      <main className="flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-7xl space-y-4">
          {viewModels.map(({ entry, review, diffHeatmap }) => (
            <FileDiffCard
              key={entry.anchorId}
              entry={entry}
              isActive={entry.file.filename === selectedFilePath}
              review={review}
              diffHeatmap={diffHeatmap}
              theme={theme}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

function FileTreeNavigator({
  root,
  selectedPath,
  onSelectFile,
}: {
  root: FileTreeNode;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    new Set(
      root.children
        .filter((node) => node.children.length > 0)
        .map((node) => node.path)
    )
  );

  const toggleExpanded = useCallback((path: string) => {
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const renderNode = useCallback(
    (node: FileTreeNode, depth: number): ReactNode[] => {
      if (!node.name) {
        return node.children.flatMap((child) => renderNode(child, 0));
      }

      const isDir = node.children.length > 0;
      const isExpanded = expandedPaths.has(node.path);
      const isActive = node.path === selectedPath;

      if (isDir) {
        return [
          <button
            key={node.path}
            type="button"
            onClick={() => toggleExpanded(node.path)}
            className="flex w-full items-center gap-1 rounded-md px-2.5 py-1 text-left text-sm transition hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            style={{ paddingLeft: depth * 14 + 10 }}
          >
            <span className="flex h-4 w-4 items-center justify-center text-neutral-400">
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </span>
            <Folder className="h-3.5 w-3.5 text-neutral-500" />
            <span className="truncate font-medium text-neutral-700">
              {node.name}
            </span>
          </button>,
          ...(isExpanded
            ? node.children.flatMap((child) => renderNode(child, depth + 1))
            : []),
        ];
      }

      const statusMeta = getFileStatusMeta(node.file?.status);

      return [
        <button
          key={node.path}
          type="button"
          onClick={() => onSelectFile(node.path)}
          className={cn(
            "flex w-full items-center gap-1 rounded-md px-2.5 py-1 text-left text-sm transition hover:bg-neutral-100",
            isActive
              ? "bg-sky-100/80 text-sky-900 shadow-sm"
              : "text-neutral-700"
          )}
          style={{ paddingLeft: depth * 14 + 32 }}
        >
          <span
            className={cn(
              "flex h-3.5 w-3.5 items-center justify-center",
              statusMeta.colorClassName
            )}
          >
            {statusMeta.icon}
          </span>
          <span className="truncate font-medium">{node.name}</span>
        </button>,
      ];
    },
    [expandedPaths, selectedPath, toggleExpanded, onSelectFile]
  );

  return (
    <div className="space-y-0.5">
      {root.children.flatMap((node) => renderNode(node, 0))}
    </div>
  );
}

function FileDiffCard({
  entry,
  isActive,
  review,
  diffHeatmap,
  theme,
}: {
  entry: ParsedFileDiff;
  isActive: boolean;
  review: FileOutput | null;
  diffHeatmap: DiffHeatmap | null;
  theme: "light" | "dark";
}) {
  const { file, diffFile, anchorId, error } = entry;
  const cardRef = useRef<HTMLElement | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const statusMeta = useMemo(
    () => getFileStatusMeta(file.status),
    [file.status]
  );

  useEffect(() => {
    if (isActive) {
      setIsCollapsed(false);
    }
  }, [isActive]);

  const reviewContent = useMemo(() => {
    if (!review) {
      return null;
    }

    return extractAutomatedReviewText(review.codexReviewOutput);
  }, [review]);

  const showReview = false;

  // Create extend data for heatmap overlays
  const extendData = useMemo(() => {
    if (!diffHeatmap) {
      return undefined;
    }

    const newFileData: Record<number, { data: HeatmapTooltipMeta }> = {};
    for (const [lineNumber, metadata] of diffHeatmap.entries.entries()) {
      const score = metadata.score ?? null;
      if (score !== null && score > 0) {
        newFileData[lineNumber] = {
          data: {
            score,
            reason: metadata.reason ?? null,
          },
        };
      }
    }

    return Object.keys(newFileData).length > 0
      ? { oldFile: {}, newFile: newFileData }
      : undefined;
  }, [diffHeatmap]);

  return (
    <TooltipProvider
      delayDuration={120}
      skipDelayDuration={100}
      disableHoverableContent
    >
      <article
        id={anchorId}
        ref={cardRef}
        className={cn(
          "overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm transition focus:outline-none",
          isActive ? "ring-1 ring-sky-200" : "ring-0"
        )}
        tabIndex={-1}
        aria-current={isActive}
      >
        <button
          type="button"
          onClick={() => setIsCollapsed((previous) => !previous)}
          className="flex w-full items-center gap-3 border-b border-neutral-200 bg-neutral-50/80 px-3.5 py-2.5 text-left transition hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          aria-expanded={!isCollapsed}
        >
          <span className="flex h-5 w-5 items-center justify-center text-neutral-400">
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </span>

          <span
            className={cn(
              "flex h-5 w-5 items-center justify-center",
              statusMeta.colorClassName
            )}
          >
            {statusMeta.icon}
            <span className="sr-only">{statusMeta.label}</span>
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-mono text-xs text-neutral-700 truncate">
              {file.filename}
            </span>
            {file.previous_filename ? (
              <span className="font-mono text-[11px] text-neutral-500 truncate">
                Renamed from {file.previous_filename}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2 text-[11px] font-medium text-neutral-600">
            <span className="text-emerald-600">+{file.additions}</span>
            <span className="text-rose-600">-{file.deletions}</span>
          </div>
        </button>

        {showReview ? (
          <div className="border-b border-neutral-200 bg-sky-50 px-4 py-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-700">
              <Sparkles className="h-4 w-4" aria-hidden />
              Automated review
            </div>
            <pre className="mt-2 max-h-[9.5rem] overflow-hidden whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-neutral-900">
              {reviewContent}
            </pre>
          </div>
        ) : null}

        {!isCollapsed ? (
          diffFile ? (
            <div className="overflow-auto bg-white">
              <DiffView
                diffFile={diffFile}
                diffViewMode={DiffModeEnum.Split}
                diffViewHighlight={true}
                diffViewWrap={false}
                diffViewTheme={theme}
                diffViewFontSize={12}
                extendData={extendData}
                renderExtendLine={({ data }) => {
                  if (!data) return null;
                  const meta = data as HeatmapTooltipMeta;
                  return (
                    <div className="border-t border-b border-amber-200 bg-amber-50/50 px-3 py-2 text-xs">
                      <HeatmapTooltipBody
                        score={meta.score}
                        reason={meta.reason}
                      />
                    </div>
                  );
                }}
              />
            </div>
          ) : (
            <div className="bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
              {error ??
                "Diff content is unavailable for this file. It might be binary or too large to display."}
            </div>
          )
        ) : null}
      </article>
    </TooltipProvider>
  );
}

function HeatmapTooltipBody({
  score,
  reason,
}: {
  score: number;
  reason: string | null;
}) {
  const theme = getHeatmapTooltipTheme(score);
  return (
    <div className="space-y-1">
      <div className={cn("text-xs font-semibold", theme.titleClass)}>
        Review Score: {(score * 100).toFixed(0)}%
      </div>
      {reason ? (
        <div className={cn("text-xs leading-relaxed", theme.reasonClass)}>
          {reason}
        </div>
      ) : null}
    </div>
  );
}

function getHeatmapTooltipTheme(score: number): HeatmapTooltipTheme {
  if (score >= 0.8) {
    return {
      contentClass: "bg-red-50 border-red-200",
      titleClass: "text-red-900",
      reasonClass: "text-red-800",
    };
  }
  if (score >= 0.6) {
    return {
      contentClass: "bg-orange-50 border-orange-200",
      titleClass: "text-orange-900",
      reasonClass: "text-orange-800",
    };
  }
  if (score >= 0.4) {
    return {
      contentClass: "bg-amber-50 border-amber-200",
      titleClass: "text-amber-900",
      reasonClass: "text-amber-800",
    };
  }
  return {
    contentClass: "bg-yellow-50 border-yellow-200",
    titleClass: "text-yellow-900",
    reasonClass: "text-yellow-800",
  };
}

function extractAutomatedReviewText(output: string | null): string | null {
  if (!output) {
    return null;
  }

  try {
    const parsed = JSON.parse(output);
    return parsed.review ?? parsed.content ?? output;
  } catch {
    return output;
  }
}

