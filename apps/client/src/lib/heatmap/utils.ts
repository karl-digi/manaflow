/**
 * Heatmap utility functions.
 * Based on apps/www/components/pr/heatmap.ts
 */

import type { DiffLineSide } from "./types";
import {
  SCORE_CLAMP_MIN,
  SCORE_CLAMP_MAX,
  HEATMAP_GRADIENT_STEPS,
  HEATMAP_LINE_CLASS_PREFIX,
  HEATMAP_CHAR_CLASS_PREFIX,
  HEATMAP_SIDE_CLASS,
} from "./constants";

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

export function buildHeatmapLineClass(step: number): string {
  return `${HEATMAP_LINE_CLASS_PREFIX}-${step}`;
}

export function buildHeatmapCharClass(
  side: DiffLineSide,
  step: number
): string {
  const gradientClass = `${HEATMAP_CHAR_CLASS_PREFIX}-${step}`;
  return `cmux-heatmap-char ${HEATMAP_SIDE_CLASS[side]} ${gradientClass}`;
}

export function extractHeatmapGradientStep(className: string): number {
  const match = className.match(
    new RegExp(`${HEATMAP_LINE_CLASS_PREFIX}-(\\d+)`)
  );
  if (!match) {
    return 0;
  }
  const parsed = Number.parseInt(match[1] ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function computeHeatmapGradientStep(score: number | null): number {
  if (score === null) {
    return 0;
  }
  const normalized = clamp(score, SCORE_CLAMP_MIN, SCORE_CLAMP_MAX);
  if (normalized <= 0) {
    return 0;
  }
  const scaled = Math.round(normalized * HEATMAP_GRADIENT_STEPS);
  return Math.max(1, Math.min(HEATMAP_GRADIENT_STEPS, scaled));
}

export function parseLineNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const integer = Math.floor(value);
    return integer > 0 ? integer : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const candidate = extractLineNumberCandidate(value);
  if (!candidate) {
    return null;
  }

  const numeric = parseNullableNumber(candidate);
  if (numeric === null) {
    return null;
  }

  const integer = Math.floor(numeric);
  return Number.isFinite(integer) && integer > 0 ? integer : null;
}

function extractLineNumberCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  const lineMatch =
    trimmed.match(/^line\s*([+-]?\d+(?:\.\d+)?)(?:\s*[:\-–])?$/i);
  if (lineMatch && lineMatch[1]) {
    return lineMatch[1];
  }

  return null;
}

export function parseNullableNumber(value: unknown): number | null {
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

export function parseNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeLineText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const { content } = stripDiffMarker(value);
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

export function toSearchableText(value: string | null | undefined): string | null {
  const normalized = normalizeLineText(value);
  return normalized ? normalized.toLowerCase() : null;
}

export function stripDiffMarker(value: string): { content: string; offset: number } {
  if (!value) {
    return { content: "", offset: 0 };
  }

  const firstChar = value[0] ?? "";
  if (firstChar === "+" || firstChar === "-" || firstChar === " ") {
    return { content: value.slice(1), offset: 1 };
  }

  return { content: value, offset: 0 };
}

export function stripSurroundingQuotes(value: string): string {
  return value.replace(/^["'`]+|["'`]+$/g, "");
}

export function sanitizeHighlightToken(value: string): string {
  return value.replace(/^[^A-Za-z0-9_$]+/, "").replace(/[^A-Za-z0-9_$]+$/, "");
}

export type RgbColor = {
  r: number;
  g: number;
  b: number;
};

export function isValidHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

export function parseHexColor(value: string): RgbColor | null {
  if (!isValidHexColor(value)) {
    return null;
  }
  const normalized = value.replace("#", "");
  if (normalized.length === 3) {
    const [r, g, b] = normalized
      .split("")
      .map((char) => Number.parseInt(char.repeat(2), 16));
    if (r === undefined || g === undefined || b === undefined) {
      return null;
    }
    return { r, g, b };
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return null;
  }
  return { r, g, b };
}

export function mixRgb(start: RgbColor, end: RgbColor, ratio: number): RgbColor {
  const clampRatio = Math.min(Math.max(ratio, 0), 1);
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * clampRatio);
  return {
    r: lerp(start.r, end.r),
    g: lerp(start.g, end.g),
    b: lerp(start.b, end.b),
  };
}

export function rgbaString(color: RgbColor, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha.toFixed(3)})`;
}

export function clampAlpha(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0.1), 0.85);
}

export function getContrastingTextColor(color: RgbColor): string {
  const normalized = {
    r: color.r / 255,
    g: color.g / 255,
    b: color.b / 255,
  };
  const luminance =
    0.2126 * normalized.r + 0.7152 * normalized.g + 0.0722 * normalized.b;
  return luminance > 0.6 ? "#1f2937" : "#fefefe";
}

export function normalizeHexColor(value: string): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return isValidHexColor(withHash) ? withHash.toLowerCase() : null;
}
