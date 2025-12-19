/**
 * Heatmap constants.
 * Based on apps/www/components/pr/heatmap.ts
 */

export const SCORE_CLAMP_MIN = 0;
export const SCORE_CLAMP_MAX = 1;

export const HEATMAP_GRADIENT_STEPS = 100;

export const HEATMAP_LINE_CLASS_PREFIX = "cmux-heatmap-gradient-step";
export const HEATMAP_CHAR_CLASS_PREFIX = "cmux-heatmap-char-gradient-step";

export const HEATMAP_SIDE_CLASS = {
  new: "cmux-heatmap-char-new",
  old: "cmux-heatmap-char-old",
} as const;

export const DEFAULT_HEATMAP_COLORS = {
  line: {
    start: "#fefce8",
    end: "#f8e1c9",
  },
  token: {
    start: "#fde047",
    end: "#ffa270",
  },
} as const;

// Dark mode colors - adjusted for better visibility on dark backgrounds
export const DEFAULT_HEATMAP_COLORS_DARK = {
  line: {
    start: "#422006",
    end: "#7c2d12",
  },
  token: {
    start: "#854d0e",
    end: "#c2410c",
  },
} as const;
