import { DiffFile, getSplitContentLines } from "@git-diff-view/react";

export type ReviewHeatmapLine = {
  lineNumber: number | null;
  lineText: string | null;
  score: number | null;
  reason: string | null;
  mostImportantCharacterIndex: number | null;
};

export type ResolvedHeatmapLine = {
  lineNumber: number;
  score: number | null;
  reason: string | null;
  mostImportantCharacterIndex: number | null;
  contentLength: number;
  highlightRatio: number | null;
};

export type DiffHeatmap = {
  tiers: Map<number, number>;
  entries: Map<number, ResolvedHeatmapLine>;
};

type HeatmapCandidate = {
  lineNumber: number;
  score: number | null;
  reason: string | null;
  mostImportantCharacterIndex: number | null;
};

const SCORE_CLAMP_MIN = 0;
const SCORE_CLAMP_MAX = 1;

const HEATMAP_TIERS = [0.2, 0.4, 0.6, 0.8] as const;

export function parseReviewHeatmap(raw: unknown): ReviewHeatmapLine[] {
  const payload = unwrapCodexPayload(raw);
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const lines = Array.isArray((payload as { lines?: unknown }).lines)
    ? ((payload as { lines: unknown[] }).lines ?? [])
    : [];

  const parsed: ReviewHeatmapLine[] = [];

  for (const entry of lines) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const lineNumber = parseLineNumber(record.line);
    const lineText =
      typeof record.line === "string" ? record.line.trim() : null;

    if (lineNumber === null && !lineText) {
      continue;
    }

    const rawScore = parseNullableNumber(record.shouldBeReviewedScore);
    const normalizedScore =
      rawScore === null
        ? null
        : clamp(rawScore, SCORE_CLAMP_MIN, SCORE_CLAMP_MAX);

    if (normalizedScore === null || normalizedScore <= 0) {
      continue;
    }

    const reason = parseNullableString(record.shouldReviewWhy);
    const mostImportantCharacterIndex = parseNullableInteger(
      record.mostImportantCharacterIndex
    );

    parsed.push({
      lineNumber,
      lineText,
      score: normalizedScore,
      reason,
      mostImportantCharacterIndex,
    });
  }

  parsed.sort((a, b) => {
    const aLine = a.lineNumber ?? Number.MAX_SAFE_INTEGER;
    const bLine = b.lineNumber ?? Number.MAX_SAFE_INTEGER;
    if (aLine !== bLine) {
      return aLine - bLine;
    }
    return (a.lineText ?? "").localeCompare(b.lineText ?? "");
  });
  return parsed;
}

export function buildDiffHeatmap(
  diff: DiffFile | null,
  reviewHeatmap: ReviewHeatmapLine[]
): DiffHeatmap | null {
  if (!diff || reviewHeatmap.length === 0) {
    return null;
  }

  const newLineContent = collectNewLineContent(diff);
  if (newLineContent.size === 0) {
    return null;
  }

  const resolvedEntries = resolveLineNumbers(reviewHeatmap, newLineContent);
  if (resolvedEntries.length === 0) {
    return null;
  }

  const aggregated = aggregateEntries(resolvedEntries);
  if (aggregated.size === 0) {
    return null;
  }

  const tiers = new Map<number, number>();
  const entries = new Map<number, ResolvedHeatmapLine>();

  for (const [lineNumber, entry] of aggregated.entries()) {
    const normalizedScore =
      entry.score === null
        ? null
        : clamp(entry.score, SCORE_CLAMP_MIN, SCORE_CLAMP_MAX);
    const tier = computeHeatmapTier(normalizedScore);
    if (tier > 0) {
      tiers.set(lineNumber, tier);
    }

    const content = newLineContent.get(lineNumber) ?? "";
    const highlightIndex =
      entry.mostImportantCharacterIndex !== null
        ? clamp(entry.mostImportantCharacterIndex, 0, Number.MAX_SAFE_INTEGER)
        : null;
    const highlightRatio =
      highlightIndex !== null && content.length > 0
        ? clamp(
            highlightIndex / Math.max(content.length - 1, 1),
            0,
            1
          )
        : null;

    entries.set(lineNumber, {
      lineNumber,
      score: entry.score,
      reason: entry.reason,
      mostImportantCharacterIndex: entry.mostImportantCharacterIndex,
      contentLength: content.length,
      highlightRatio,
    });
  }

  if (tiers.size === 0 && entries.size === 0) {
    return null;
  }

  return {
    tiers,
    entries,
  };
}

function aggregateEntries(
  entries: HeatmapCandidate[]
): Map<number, HeatmapCandidate> {
  const aggregated = new Map<number, HeatmapCandidate>();

  for (const entry of entries) {
    const current = aggregated.get(entry.lineNumber);

    if (!current) {
      aggregated.set(entry.lineNumber, { ...entry });
      continue;
    }

    const currentScore = current.score ?? SCORE_CLAMP_MIN;
    const nextScore = entry.score ?? SCORE_CLAMP_MIN;
    const shouldReplaceScore = nextScore > currentScore;

    aggregated.set(entry.lineNumber, {
      lineNumber: entry.lineNumber,
      score: shouldReplaceScore ? entry.score : current.score,
      reason: entry.reason ?? current.reason,
      mostImportantCharacterIndex:
        entry.mostImportantCharacterIndex ?? current.mostImportantCharacterIndex,
    });
  }

  return aggregated;
}

function resolveLineNumbers(
  entries: ReviewHeatmapLine[],
  lineContent: Map<number, string>
): HeatmapCandidate[] {
  const resolved: HeatmapCandidate[] = [];
  const lineEntries = Array.from(lineContent.entries());
  const searchOffsets = new Map<string, number>();

  for (const entry of entries) {
    if (entry.score === null) {
      continue;
    }

    const directLine =
      entry.lineNumber && lineContent.has(entry.lineNumber)
        ? entry.lineNumber
        : null;

    if (directLine) {
      resolved.push({
        lineNumber: directLine,
        score: entry.score,
        reason: entry.reason,
        mostImportantCharacterIndex: entry.mostImportantCharacterIndex,
      });
      continue;
    }

    const normalizedTarget = normalizeLineText(entry.lineText);
    if (!normalizedTarget) {
      continue;
    }

    const candidate = findLineByText(
      normalizedTarget,
      lineEntries,
      searchOffsets
    );

    if (candidate !== null) {
      resolved.push({
        lineNumber: candidate,
        score: entry.score,
        reason: entry.reason,
        mostImportantCharacterIndex: entry.mostImportantCharacterIndex,
      });
    }
  }

  return resolved;
}

function findLineByText(
  normalizedTarget: string,
  lineEntries: Array<[number, string]>,
  searchOffsets: Map<string, number>
): number | null {
  const entriesCount = lineEntries.length;
  const startIndex = searchOffsets.get(normalizedTarget) ?? 0;

  for (let index = startIndex; index < entriesCount; index += 1) {
    const [lineNumber, rawText] = lineEntries[index]!;
    const normalizedSource = normalizeLineText(rawText);
    if (!normalizedSource) {
      continue;
    }

    if (normalizedSource === normalizedTarget) {
      searchOffsets.set(normalizedTarget, index + 1);
      return lineNumber;
    }

    if (normalizedSource.includes(normalizedTarget)) {
      searchOffsets.set(normalizedTarget, index + 1);
      return lineNumber;
    }
  }

  searchOffsets.set(normalizedTarget, entriesCount);
  return null;
}

function normalizeLineText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/\s+/g, " ").trim();
}

function collectNewLineContent(diff: DiffFile): Map<number, string> {
  const map = new Map<number, string>();

  const lines = getSplitContentLines(diff);
  for (const item of lines) {
    const right = item.splitLine.right;
    const lineNumber = right?.lineNumber ?? null;
    if (lineNumber === null || lineNumber <= 0) {
      continue;
    }
    // Skip placeholder rows that have no textual content
    if (typeof right?.value !== "string") {
      continue;
    }
    map.set(lineNumber, right.value);
  }

  return map;
}

function computeHeatmapTier(score: number | null): number {
  if (score === null) {
    return 0;
  }

  for (let index = HEATMAP_TIERS.length - 1; index >= 0; index -= 1) {
    if (score >= HEATMAP_TIERS[index]!) {
      return index + 1;
    }
  }

  return score > 0 ? 1 : 0;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function parseLineNumber(value: unknown): number | null {
  const numeric = parseNullableNumber(value);
  if (numeric === null) {
    return null;
  }

  const integer = Math.floor(numeric);
  return Number.isFinite(integer) && integer > 0 ? integer : null;
}

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const match = value.match(/-?\d+(\.\d+)?/);
    if (!match) {
      return null;
    }
    const parsed = Number.parseFloat(match[0] ?? "");
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseNullableInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const match = value.match(/-?\d+/);
    if (!match) {
      return null;
    }
    const parsed = Number.parseInt(match[0] ?? "", 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unwrapCodexPayload(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return unwrapCodexPayload(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (typeof record.response === "string" || typeof record.response === "object") {
      return unwrapCodexPayload(record.response);
    }

    if (
      typeof record.payload === "string" ||
      typeof record.payload === "object"
    ) {
      return unwrapCodexPayload(record.payload);
    }

    if (Array.isArray(record.lines)) {
      return record;
    }
  }

  return null;
}
