import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";
import { generateDiffFile } from "@git-diff-view/file";
import { getDiffViewHighlighter } from "@git-diff-view/shiki";
import type { BundledLanguage, DiffHighlighter } from "@git-diff-view/shiki";

import {
  AUTO_COLLAPSE_THRESHOLD,
  MAX_LINES_FOR_SYNTAX,
  type PreparedDiffFile,
} from "./types";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  sh: "shell",
  bash: "bash",
  zsh: "bash",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  m: "objectivec",
  mm: "objectivec",
  php: "php",
  rb: "ruby",
  sql: "sql",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  xml: "xml",
  vue: "vue",
  svelte: "html",
  dart: "dart",
  scala: "scala",
  txt: "plaintext",
};

const SHIKI_LANGUAGES: BundledLanguage[] = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "rust",
  "go",
  "java",
  "css",
  "html",
  "json",
  "yaml",
  "markdown",
  "bash",
  "sql",
  "xml",
  "shellscript",
  "diff",
];

let highlighterPromise: Promise<DiffHighlighter> | null = null;

export async function getHighlighter(): Promise<DiffHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = getDiffViewHighlighter(SHIKI_LANGUAGES);
  }

  const highlighter = await highlighterPromise;
  highlighter.setMaxLineToIgnoreSyntax(MAX_LINES_FOR_SYNTAX);
  highlighter.setIgnoreSyntaxHighlightList([
    "package-lock.json",
    "bun.lockb",
    /\.min\.js$/,
    /\.bundle\.js$/,
  ]);

  return highlighter;
}

export function detectLanguage(filePath: string): string {
  const normalized = filePath.trim().toLowerCase();
  if (!normalized) {
    return "plaintext";
  }

  const fileName = normalized.split("/").pop() ?? normalized;

  if (fileName === "dockerfile") {
    return "dockerfile";
  }

  if (fileName === "makefile" || fileName === "gnumakefile") {
    return "makefile";
  }

  if (fileName === "cmakelists.txt") {
    return "cmake";
  }

  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return "plaintext";
  }

  const extension = fileName.slice(dotIndex + 1);
  return LANGUAGE_BY_EXTENSION[extension] ?? "plaintext";
}

export function prepareDiffFile(
  entry: ReplaceDiffEntry,
  theme: "light" | "dark",
): PreparedDiffFile {
  const totalLinesFromEntry = entry.additions + entry.deletions;

  if (
    entry.contentOmitted ||
    entry.isBinary ||
    entry.status === "deleted" ||
    entry.status === "renamed"
  ) {
    return {
      entry,
      diffFile: null,
      language: "",
      totalLines: totalLinesFromEntry,
    };
  }

  const oldPath = entry.oldPath ?? entry.filePath;
  const newPath = entry.filePath;
  const oldContent = entry.oldContent ?? "";
  const newContent = entry.newContent ?? "";

  const oldLanguage = detectLanguage(oldPath);
  const newLanguage = detectLanguage(newPath);

  const diffFile = generateDiffFile(
    oldPath,
    oldContent,
    newPath,
    newContent,
    oldLanguage,
    newLanguage,
  );

  diffFile.initTheme(theme);
  diffFile.initRaw();
  diffFile.buildSplitDiffLines();
  diffFile.buildUnifiedDiffLines();

  return {
    entry,
    diffFile,
    language: newLanguage,
    totalLines: Math.max(
      totalLinesFromEntry,
      diffFile.additionLength + diffFile.deletionLength,
    ),
  };
}

export function prepareDiffFiles(
  diffs: ReplaceDiffEntry[],
  theme: "light" | "dark",
): PreparedDiffFile[] {
  return diffs.map((entry) => prepareDiffFile(entry, theme));
}

export function shouldAutoCollapseFile(
  totalLines: number,
  status: ReplaceDiffEntry["status"],
): boolean {
  if (status === "deleted" || status === "renamed") {
    return true;
  }
  return totalLines > AUTO_COLLAPSE_THRESHOLD;
}

export function getDiffAnchorId(filePath: string): string {
  return `diff-file-${encodeURIComponent(filePath)}`;
}
