'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
} from "lucide-react";
import {
  Decoration,
  Diff,
  Hunk,
  isDelete,
  isInsert,
  parseDiff,
  tokenize,
  type ChangeData,
  type FileData,
  type HunkTokens,
} from "react-diff-view";
import "react-diff-view/style/index.css";

import type { GithubPullRequestFile } from "@/lib/github/fetch-pull-request";
import { cn } from "@/lib/utils";
import { refractor } from "refractor/all";

type PullRequestDiffViewerProps = {
  files: GithubPullRequestFile[];
};

type ParsedFileDiff = {
  file: GithubPullRequestFile;
  anchorId: string;
  diff: FileData | null;
  error?: string;
};

type RefractorNode =
  | {
      type: "text";
      value: string;
    }
  | {
      type: string;
      children?: RefractorNode[];
      [key: string]: unknown;
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
  "gitignore": "bash",
  "env": "bash",
  "env.example": "bash",
  gemfile: "ruby",
  podfile: "ruby",
  brewfile: "ruby",
  "package-lock.json": "json",
  "yarn.lock": "yaml",
  "pnpm-lock.yaml": "yaml",
  "bun.lock": "toml",
};

type RefractorLike = {
  highlight(code: string, language: string): unknown;
};

function createRefractorAdapter(base: RefractorLike) {
  const isNodeWithChildren = (
    value: unknown,
  ): value is { children: RefractorNode[] } => {
    return (
      typeof value === "object" &&
      value !== null &&
      "children" in value &&
      Array.isArray((value as { children?: unknown }).children)
    );
  };

  return {
    highlight(code: string, language: string): RefractorNode[] {
      const result = base.highlight(code, language);

      if (Array.isArray(result)) {
        return result;
      }

      if (isNodeWithChildren(result)) {
        return result.children;
      }

      const fallbackNode: RefractorNode = {
        type: "text",
        value: code,
      };

      return [fallbackNode];
    },
  };
}

const refractorAdapter = createRefractorAdapter(refractor);

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
  file?: GithubPullRequestFile;
};

export function PullRequestDiffViewer({
  files,
}: PullRequestDiffViewerProps) {
  const parsedDiffs = useMemo<ParsedFileDiff[]>(() => {
    return files.map((file) => {
      if (!file.patch) {
        return {
          file,
          anchorId: file.filename,
          diff: null,
          error:
            "GitHub did not return a textual diff for this file. It may be binary or too large.",
        };
      }

      try {
        const [diff] = parseDiff(buildDiffText(file));
        return {
          file,
          anchorId: file.filename,
          diff: diff ?? null,
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to parse GitHub patch payload.";
        return {
          file,
          anchorId: file.filename,
          diff: null,
          error: message,
        };
      }
    });
  }, [files]);

  const fileTree = useMemo(() => buildFileTree(files), [files]);
  const directoryPaths = useMemo(
    () => collectDirectoryPaths(fileTree),
    [fileTree],
  );

  const hydratedInitialPath =
    typeof window !== "undefined"
      ? decodeURIComponent(window.location.hash.slice(1))
      : "";

  const firstPath = parsedDiffs[0]?.file.filename ?? "";
  const initialPath =
    hydratedInitialPath && files.some((file) => file.filename === hydratedInitialPath)
      ? hydratedInitialPath
      : firstPath;

  const [activePath, setActivePath] = useState<string>(initialPath);
  const [activeAnchor, setActiveAnchor] = useState<string>(initialPath);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const defaults = new Set<string>(directoryPaths);
    for (const parent of getParentPaths(initialPath)) {
      defaults.add(parent);
    }
    return defaults;
  });

  useEffect(() => {
    setExpandedPaths(() => {
      const defaults = new Set<string>(directoryPaths);
      for (const parent of getParentPaths(activePath)) {
        defaults.add(parent);
      }
      return defaults;
    });
  }, [directoryPaths, activePath]);

  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash && files.some((file) => file.filename === hash)) {
      setActivePath(hash);
      setActiveAnchor(hash);
    }
  }, [files]);

  useEffect(() => {
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      for (const parent of getParentPaths(activePath)) {
        next.add(parent);
      }
      return next;
    });
  }, [activePath]);

  useEffect(() => {
    if (parsedDiffs.length === 0) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              a.target.getBoundingClientRect().top -
              b.target.getBoundingClientRect().top,
          );

        if (visible[0]?.target.id) {
          setActiveAnchor(visible[0].target.id);
          return;
        }

        const nearest = entries
          .map((entry) => ({
            id: entry.target.id,
            top: entry.target.getBoundingClientRect().top,
          }))
          .sort((a, b) => Math.abs(a.top) - Math.abs(b.top))[0];

        if (nearest?.id) {
          setActiveAnchor(nearest.id);
        }
      },
      {
        rootMargin: "-128px 0px -55% 0px",
        threshold: [0, 0.2, 0.4, 0.6, 1],
      },
    );

    const elements = parsedDiffs
      .map((entry) => document.getElementById(entry.anchorId))
      .filter((element): element is HTMLElement => Boolean(element));

    elements.forEach((element) => observer.observe(element));

    return () => {
      elements.forEach((element) => observer.unobserve(element));
      observer.disconnect();
    };
  }, [parsedDiffs]);

  const handleNavigate = useCallback((path: string) => {
    setActivePath(path);
    setActiveAnchor(path);

    if (typeof window === "undefined") {
      return;
    }

    window.location.hash = encodeURIComponent(path);
  }, []);

  const handleToggleDirectory = useCallback((path: string) => {
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

  if (files.length === 0) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-sm text-neutral-600 shadow-sm">
        This pull request does not introduce any file changes.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
      <aside className="lg:sticky lg:top-6 lg:h-[calc(100vh-96px)] lg:w-80 lg:overflow-y-auto">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <FileTreeNavigator
            nodes={fileTree}
            activePath={activeAnchor}
            expandedPaths={expandedPaths}
            onToggleDirectory={handleToggleDirectory}
            onSelectFile={handleNavigate}
          />
        </div>
      </aside>

      <div className="flex-1 space-y-6">
        {parsedDiffs.map((entry) => (
          <FileDiffCard
            key={entry.anchorId}
            entry={entry}
            isActive={entry.anchorId === activeAnchor}
          />
        ))}
      </div>
    </div>
  );
}

type FileTreeNavigatorProps = {
  nodes: FileTreeNode[];
  activePath: string;
  expandedPaths: Set<string>;
  onToggleDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
  depth?: number;
};

function FileTreeNavigator({
  nodes,
  activePath,
  expandedPaths,
  onToggleDirectory,
  onSelectFile,
  depth = 0,
}: FileTreeNavigatorProps) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => {
        const isDirectory = node.children.length > 0;
        const isExpanded = expandedPaths.has(node.path);
        const isActive = activePath === node.path;

        if (isDirectory) {
          return (
            <div key={node.path}>
              <button
                type="button"
                onClick={() => onToggleDirectory(node.path)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition hover:bg-neutral-100",
                  isExpanded ? "text-neutral-900" : "text-neutral-700",
                )}
                style={{ paddingLeft: depth * 16 + 8 }}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-neutral-500" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-neutral-500" />
                )}
                <Folder className="h-4 w-4 text-neutral-500" />
                <span className="truncate">{node.name}</span>
              </button>
              {isExpanded ? (
                <div className="mt-1">
                  <FileTreeNavigator
                    nodes={node.children}
                    activePath={activePath}
                    expandedPaths={expandedPaths}
                    onToggleDirectory={onToggleDirectory}
                    onSelectFile={onSelectFile}
                    depth={depth + 1}
                  />
                </div>
              ) : null}
            </div>
          );
        }

        return (
          <button
            key={node.path}
            type="button"
            onClick={() => onSelectFile(node.path)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-neutral-100",
              isActive ? "bg-sky-100/80 text-sky-900 shadow-sm" : "text-neutral-700",
            )}
            style={{ paddingLeft: depth * 16 + 32 }}
          >
            <FileText className="h-4 w-4 text-neutral-500" />
            <span className="truncate font-medium">{node.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function FileDiffCard({
  entry,
  isActive,
}: {
  entry: ParsedFileDiff;
  isActive: boolean;
}) {
  const { file, diff, anchorId, error } = entry;
  const language = useMemo(() => inferLanguage(file.filename), [file.filename]);
  const tokens = useMemo<HunkTokens | null>(() => {
    if (!diff) {
      return null;
    }

    if (language && refractor.registered(language)) {
      try {
        return tokenize(diff.hunks, {
          highlight: true,
          language,
          refractor: refractorAdapter,
        });
      } catch (error) {
        console.warn("[diff-viewer] highlight failed", file.filename, error);
      }
    }

    return tokenize(diff.hunks);
  }, [diff, language, file.filename]);

  return (
    <article
      id={anchorId}
      className={cn(
        "overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm transition focus:outline-none",
        isActive
          ? "ring-2 ring-sky-300 ring-offset-2 ring-offset-neutral-50"
          : "ring-0 ring-offset-0",
      )}
      tabIndex={-1}
      aria-current={isActive}
    >
      <header className="flex flex-wrap items-center gap-4 border-b border-neutral-200 bg-neutral-100/80 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-3">
            <span className="truncate font-medium text-neutral-900">
              {file.filename}
            </span>
            <StatusBadge status={file.status} />
          </div>
          {file.previous_filename ? (
            <span className="text-xs text-neutral-500">
              Renamed from {file.previous_filename}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-neutral-600">
          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-emerald-700">
            +{file.additions}
          </span>
          <span className="rounded-md bg-rose-100 px-2 py-0.5 text-rose-700">
            -{file.deletions}
          </span>
        </div>
      </header>

      {diff ? (
        <Diff
          diffType={diff.type}
          hunks={diff.hunks}
          viewType="split"
          optimizeSelection
          className="diff-syntax jetbrains-mono-force overflow-auto bg-white text-xs leading-5 text-neutral-800"
          gutterClassName="jetbrains-mono-force bg-white text-xs text-neutral-500"
          codeClassName="jetbrains-mono-force text-xs text-neutral-800"
          tokens={tokens ?? undefined}
          generateLineClassName={({ changes, defaultGenerate }) => {
            const defaultClassName = defaultGenerate();
            const classNames: string[] = [
              "jetbrains-mono-force text-xs py-1",
            ];
            const normalizedChanges = changes.filter(
              (change): change is ChangeData => Boolean(change),
            );
            const hasInsert = normalizedChanges.some((change) => isInsert(change));
            const hasDelete = normalizedChanges.some((change) => isDelete(change));

            if (hasInsert) {
              classNames.push(
                "bg-emerald-50 text-emerald-900",
              );
            } else if (hasDelete) {
              classNames.push(
                "bg-rose-50 text-rose-900",
              );
            } else {
              classNames.push(
                "bg-white text-neutral-800",
              );
            }

            return cn(defaultClassName, classNames);
          }}
        >
          {(hunks) =>
            hunks.map((hunk) => (
              <Fragment key={hunk.content}>
                <Decoration>
                  <div className="bg-sky-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-sky-700">
                    {hunk.content}
                  </div>
                </Decoration>
                <Hunk hunk={hunk} />
              </Fragment>
            ))
          }
        </Diff>
      ) : (
        <div className="bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
          {error ??
            "Diff content is unavailable for this file. It might be binary or too large to display."}
        </div>
      )}
    </article>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { background, text } = getStatusAppearance(status);

  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium capitalize",
        background,
        text,
      )}
    >
      {status}
    </span>
  );
}

function getStatusAppearance(status: string): {
  background: string;
  text: string;
} {
  switch (status) {
    case "added":
      return {
        background: "border border-emerald-200 bg-emerald-100",
        text: "text-emerald-700",
      };
    case "removed":
      return {
        background: "border border-rose-200 bg-rose-100",
        text: "text-rose-700",
      };
    case "renamed":
      return {
        background: "border border-amber-200 bg-amber-100",
        text: "text-amber-700",
      };
    case "modified":
    case "changed":
      return {
        background: "border border-sky-200 bg-sky-100",
        text: "text-sky-700",
      };
    default:
      return {
        background: "border border-neutral-300 bg-neutral-200",
        text: "text-neutral-700",
      };
  }
}

function buildDiffText(file: GithubPullRequestFile): string {
  const oldPath =
    file.status === "added"
      ? "/dev/null"
      : file.previous_filename ?? file.filename;
  const newPath =
    file.status === "removed" ? "/dev/null" : file.filename;

  const gitOldLabel = `a/${file.previous_filename ?? file.filename}`;
  const gitNewLabel = `b/${file.filename}`;
  const oldLabel = oldPath === "/dev/null" ? "/dev/null" : gitOldLabel;
  const newLabel = newPath === "/dev/null" ? "/dev/null" : gitNewLabel;

  return [
    `diff --git ${gitOldLabel} ${gitNewLabel}`,
    `--- ${oldLabel}`,
    `+++ ${newLabel}`,
    file.patch,
    "",
  ].join("\n");
}

function buildFileTree(files: GithubPullRequestFile[]): FileTreeNode[] {
  const root: FileTreeNode = {
    name: "",
    path: "",
    children: [],
  };

  for (const file of files) {
    const segments = file.filename.split("/");
    let current = root;

    segments.forEach((segment, index) => {
      const path =
        index === 0 ? segment : `${current.path ? `${current.path}/` : ""}${segment}`;

      let child = current.children.find((node) => node.name === segment);

      if (!child) {
        child = {
          name: segment,
          path,
          children: [],
        };
        current.children.push(child);
      }

      if (index === segments.length - 1) {
        child.file = file;
      }

      current = child;
    });
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      const aIsDir = a.children.length > 0;
      const bIsDir = b.children.length > 0;
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => {
      if (node.children.length > 0) {
        sortNodes(node.children);
      }
    });
  };

  sortNodes(root.children);

  const collapseNode = (node: FileTreeNode): FileTreeNode => {
    if (node.children.length === 0) {
      return node;
    }

    let current = node;

    while (
      current.file === undefined &&
      current.children.length === 1 &&
      current.children[0].file === undefined
    ) {
      const child = current.children[0];
      current = {
        name: current.name
          ? `${current.name}/${child.name}`
          : child.name,
        path: child.path,
        children: child.children,
        file: child.file,
      };
    }

    return {
      ...current,
      children: current.children.map((child) => collapseNode(child)),
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
