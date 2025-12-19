/**
 * Build diff heatmap from review data.
 * Based on apps/www/components/pr/heatmap.ts
 */

import type {
  ReviewHeatmapLine,
  DiffLineSide,
  ResolvedHeatmapLine,
  HeatmapEntryArtifact,
  DiffHeatmapArtifacts,
  DiffHeatmap,
  HeatmapRangeNode,
} from "./types";

import {
  parseLineNumber,
  parseNullableNumber,
  parseNullableString,
  normalizeLineText,
  toSearchableText,
  computeHeatmapGradientStep,
  buildHeatmapLineClass,
  buildHeatmapCharClass,
  sanitizeHighlightToken,
  stripSurroundingQuotes,
  stripDiffMarker,
} from "./utils";

export type DiffLine = {
  content: string;
  type: "insert" | "delete" | "normal";
  newLineNumber?: number;
  oldLineNumber?: number;
};

function parseHeatmapEntry(raw: unknown): ReviewHeatmapLine | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const lineNumber = parseLineNumber(entry.lineNumber);
  const lineText = parseNullableString(entry.lineText);
  const score = parseNullableNumber(entry.score);
  const reason = parseNullableString(entry.reason);
  const mostImportantWord = parseNullableString(entry.mostImportantWord);

  if (score === null || (lineNumber === null && lineText === null)) {
    return null;
  }

  return { lineNumber, lineText, score, reason, mostImportantWord };
}

export function parseReviewHeatmap(heatmapData: unknown): ReviewHeatmapLine[] {
  if (!Array.isArray(heatmapData)) {
    return [];
  }
  return heatmapData
    .map((item) => parseHeatmapEntry(item))
    .filter((item): item is ReviewHeatmapLine => item !== null);
}

export function resolveLineNumbers(
  raw: ReviewHeatmapLine[],
  diffLines: DiffLine[],
  targetSide: DiffLineSide
): ResolvedHeatmapLine[] {
  const results: ResolvedHeatmapLine[] = [];

  const lineNumberIndex = new Map<number, DiffLine>();
  const searchTextIndex = new Map<string, DiffLine>();

  for (const line of diffLines) {
    const lineNumber =
      targetSide === "new" ? line.newLineNumber : line.oldLineNumber;
    if (lineNumber !== undefined && lineNumber > 0) {
      lineNumberIndex.set(lineNumber, line);
    }

    const searchable = toSearchableText(line.content);
    if (searchable && !searchTextIndex.has(searchable)) {
      searchTextIndex.set(searchable, line);
    }
  }

  for (const entry of raw) {
    const resolved = tryResolve(
      entry,
      targetSide,
      lineNumberIndex,
      searchTextIndex
    );
    if (resolved) {
      results.push(resolved);
    }
  }

  return results;
}

function tryResolve(
  entry: ReviewHeatmapLine,
  side: DiffLineSide,
  lineNumberIndex: Map<number, DiffLine>,
  searchTextIndex: Map<string, DiffLine>
): ResolvedHeatmapLine | null {
  // Strategy 1: Direct line number match
  if (entry.lineNumber !== null) {
    const line = lineNumberIndex.get(entry.lineNumber);
    if (line) {
      const lineNumber =
        side === "new" ? line.newLineNumber : line.oldLineNumber;
      if (lineNumber !== undefined) {
        return {
          side,
          lineNumber,
          score: entry.score,
          reason: entry.reason,
          mostImportantWord: entry.mostImportantWord,
        };
      }
    }
  }

  // Strategy 2: Exact text match
  const searchText = toSearchableText(entry.lineText);
  if (searchText) {
    const line = searchTextIndex.get(searchText);
    if (line) {
      const lineNumber =
        side === "new" ? line.newLineNumber : line.oldLineNumber;
      if (lineNumber !== undefined) {
        return {
          side,
          lineNumber,
          score: entry.score,
          reason: entry.reason,
          mostImportantWord: entry.mostImportantWord,
        };
      }
    }
  }

  // Strategy 3: Keyword search (extract most important identifier)
  if (entry.lineText) {
    const keyword = extractKeyword(entry.lineText);
    if (keyword) {
      for (const [, line] of searchTextIndex) {
        const lineSearch = toSearchableText(line.content);
        if (lineSearch && lineSearch.includes(keyword)) {
          const lineNumber =
            side === "new" ? line.newLineNumber : line.oldLineNumber;
          if (lineNumber !== undefined) {
            return {
              side,
              lineNumber,
              score: entry.score,
              reason: entry.reason,
              mostImportantWord: entry.mostImportantWord,
            };
          }
        }
      }
    }
  }

  return null;
}

function extractKeyword(text: string): string | null {
  const normalized = normalizeLineText(text)?.toLowerCase() ?? "";
  if (!normalized) {
    return null;
  }

  // Look for identifiers (function names, variable names, etc.)
  const identifierMatch = normalized.match(/\b([a-z_$][a-z0-9_$]{2,})\b/i);
  if (identifierMatch && identifierMatch[1]) {
    return identifierMatch[1];
  }

  return null;
}

export function prepareDiffHeatmapArtifacts(
  resolved: ResolvedHeatmapLine[],
  minScore: number
): DiffHeatmapArtifacts {
  const entries = new Map<number, HeatmapEntryArtifact>();
  const oldEntries = new Map<number, HeatmapEntryArtifact>();

  let totalEntries = 0;

  for (const entry of resolved) {
    if (entry.score === null || entry.score < minScore) {
      continue;
    }

    const gradientStep = computeHeatmapGradientStep(entry.score);
    if (gradientStep === 0) {
      continue;
    }

    const highlight = computeHighlight(entry.mostImportantWord);
    const artifact: HeatmapEntryArtifact = {
      ...entry,
      gradientStep,
      highlight,
    };

    const targetMap = entry.side === "new" ? entries : oldEntries;
    targetMap.set(entry.lineNumber, artifact);
    totalEntries++;
  }

  return { entries, oldEntries, totalEntries };
}

function computeHighlight(
  token: string | null
): { start: number; length: number } | null {
  if (!token) {
    return null;
  }

  const cleaned = sanitizeHighlightToken(stripSurroundingQuotes(token.trim()));
  if (cleaned.length < 2) {
    return null;
  }

  // Highlight will be applied during render by searching the line content
  return { start: 0, length: cleaned.length };
}

export function renderDiffHeatmap(
  artifacts: DiffHeatmapArtifacts,
  diffLines: DiffLine[],
  thresholdPercent: number
): DiffHeatmap {
  const lineClasses = new Map<number, string>();
  const oldLineClasses = new Map<number, string>();
  const newRanges: HeatmapRangeNode[] = [];
  const oldRanges: HeatmapRangeNode[] = [];
  const entries = new Map<number, ResolvedHeatmapLine>();
  const oldEntries = new Map<number, ResolvedHeatmapLine>();

  const thresholdStep = Math.round((thresholdPercent / 100) * 100);

  const processEntries = (
    artifactMap: Map<number, HeatmapEntryArtifact>,
    side: DiffLineSide,
    lineClassMap: Map<number, string>,
    ranges: HeatmapRangeNode[],
    entryMap: Map<number, ResolvedHeatmapLine>
  ) => {
    for (const [lineNumber, artifact] of artifactMap) {
      if (artifact.gradientStep < thresholdStep) {
        continue;
      }

      const lineClass = buildHeatmapLineClass(artifact.gradientStep);
      lineClassMap.set(lineNumber, lineClass);

      entryMap.set(lineNumber, {
        side,
        lineNumber,
        score: artifact.score,
        reason: artifact.reason,
        mostImportantWord: artifact.mostImportantWord,
      });

      // Add character highlight if present
      if (artifact.highlight && artifact.mostImportantWord) {
        const line = diffLines.find((l) => {
          const ln = side === "new" ? l.newLineNumber : l.oldLineNumber;
          return ln === lineNumber;
        });

        if (line) {
          const { content, offset } = stripDiffMarker(line.content);
          const token = sanitizeHighlightToken(
            stripSurroundingQuotes(artifact.mostImportantWord.trim())
          );
          const tokenIndex = content.toLowerCase().indexOf(token.toLowerCase());

          if (tokenIndex !== -1) {
            ranges.push({
              type: "span",
              lineNumber,
              start: tokenIndex + offset,
              length: token.length,
              className: buildHeatmapCharClass(side, artifact.gradientStep),
            });
          }
        }
      }
    }
  };

  processEntries(artifacts.entries, "new", lineClasses, newRanges, entries);
  processEntries(
    artifacts.oldEntries,
    "old",
    oldLineClasses,
    oldRanges,
    oldEntries
  );

  return {
    lineClasses,
    oldLineClasses,
    newRanges,
    oldRanges,
    entries,
    oldEntries,
    totalEntries: artifacts.totalEntries,
  };
}

export function buildDiffHeatmap(
  heatmapData: unknown,
  diffLines: DiffLine[],
  options: {
    minScore?: number;
    thresholdPercent?: number;
  } = {}
): DiffHeatmap {
  const { minScore = 0, thresholdPercent = 0 } = options;

  const parsed = parseReviewHeatmap(heatmapData);

  // Resolve for both sides
  const newResolved = resolveLineNumbers(parsed, diffLines, "new");
  const oldResolved = resolveLineNumbers(parsed, diffLines, "old");

  const allResolved = [...newResolved, ...oldResolved];
  const artifacts = prepareDiffHeatmapArtifacts(allResolved, minScore);

  return renderDiffHeatmap(artifacts, diffLines, thresholdPercent);
}
