/**
 * Heatmap types for diff visualization.
 * Based on apps/www/components/pr/heatmap.ts
 */

export type ReviewHeatmapLine = {
  lineNumber: number | null;
  lineText: string | null;
  score: number | null;
  reason: string | null;
  mostImportantWord: string | null;
};

export type DiffLineSide = "new" | "old";

export type ResolvedHeatmapLine = {
  side: DiffLineSide;
  lineNumber: number;
  score: number | null;
  reason: string | null;
  mostImportantWord: string | null;
};

export type HeatmapEntryArtifact = ResolvedHeatmapLine & {
  gradientStep: number;
  highlight: { start: number; length: number } | null;
};

export type DiffHeatmapArtifacts = {
  entries: Map<number, HeatmapEntryArtifact>;
  oldEntries: Map<number, HeatmapEntryArtifact>;
  totalEntries: number;
};

export type HeatmapRangeNode = {
  type: "span";
  lineNumber: number;
  start: number;
  length: number;
  className: string;
};

export type DiffHeatmap = {
  lineClasses: Map<number, string>;
  oldLineClasses: Map<number, string>;
  newRanges: HeatmapRangeNode[];
  oldRanges: HeatmapRangeNode[];
  entries: Map<number, ResolvedHeatmapLine>;
  oldEntries: Map<number, ResolvedHeatmapLine>;
  totalEntries: number;
};

export type HeatmapGradientStops = {
  start: string;
  end: string;
};

export type HeatmapColorSettings = {
  line: HeatmapGradientStops;
  token: HeatmapGradientStops;
};

export type HeatmapTooltipMeta = {
  score: number;
  reason: string | null;
};

export type LineTooltipMap = Record<DiffLineSide, Map<number, HeatmapTooltipMeta>>;
