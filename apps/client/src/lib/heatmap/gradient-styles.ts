/**
 * Generate heatmap gradient CSS styles.
 * Based on apps/www/components/pr/pull-request-diff-viewer.tsx
 */

import type { HeatmapColorSettings } from "./types";
import {
  HEATMAP_GRADIENT_STEPS,
  HEATMAP_LINE_CLASS_PREFIX,
  HEATMAP_CHAR_CLASS_PREFIX,
  DEFAULT_HEATMAP_COLORS,
  DEFAULT_HEATMAP_COLORS_DARK,
} from "./constants";
import {
  parseHexColor,
  mixRgb,
  rgbaString,
  getContrastingTextColor,
  clampAlpha,
} from "./utils";

export type GeneratedGradientStyles = {
  cssText: string;
  lineStyles: Map<number, { background: string; color: string }>;
  charStyles: Map<number, { background: string; color: string }>;
};

export function buildHeatmapGradientStyles(
  colors: HeatmapColorSettings = DEFAULT_HEATMAP_COLORS,
  isDarkMode = false
): GeneratedGradientStyles {
  const effectiveColors = isDarkMode ? DEFAULT_HEATMAP_COLORS_DARK : colors;

  const lineStart = parseHexColor(effectiveColors.line.start);
  const lineEnd = parseHexColor(effectiveColors.line.end);
  const charStart = parseHexColor(effectiveColors.token.start);
  const charEnd = parseHexColor(effectiveColors.token.end);

  if (!lineStart || !lineEnd || !charStart || !charEnd) {
    return { cssText: "", lineStyles: new Map(), charStyles: new Map() };
  }

  const rules: string[] = [];
  const lineStyles = new Map<number, { background: string; color: string }>();
  const charStyles = new Map<number, { background: string; color: string }>();

  // Step 0 = no highlight
  for (let step = 0; step <= HEATMAP_GRADIENT_STEPS; step++) {
    const ratio = step / HEATMAP_GRADIENT_STEPS;

    // Line background: alpha scales from 35% to 65%
    const lineAlpha = clampAlpha(0.35 + ratio * 0.3);
    const lineColor = mixRgb(lineStart, lineEnd, ratio);
    const lineBackground = rgbaString(lineColor, lineAlpha);
    const lineTextColor = getContrastingTextColor(lineColor);

    // Character highlight: alpha scales from 55% to 80%
    const charAlpha = clampAlpha(0.55 + ratio * 0.25);
    const charColor = mixRgb(charStart, charEnd, ratio);
    const charBackground = rgbaString(charColor, charAlpha);
    const charTextColor = getContrastingTextColor(charColor);

    lineStyles.set(step, { background: lineBackground, color: lineTextColor });
    charStyles.set(step, { background: charBackground, color: charTextColor });

    // Generate CSS rules
    rules.push(`
.${HEATMAP_LINE_CLASS_PREFIX}-${step} {
  box-shadow: inset 0 0 0 9999px ${lineBackground};
  color: ${lineTextColor};
}

.${HEATMAP_CHAR_CLASS_PREFIX}-${step} {
  background-color: ${charBackground};
  color: ${charTextColor};
  border-radius: 2px;
}
`);
  }

  return {
    cssText: rules.join("\n"),
    lineStyles,
    charStyles,
  };
}

export function buildHeatmapGradientStyleElement(
  colors: HeatmapColorSettings = DEFAULT_HEATMAP_COLORS,
  isDarkMode = false
): HTMLStyleElement {
  const { cssText } = buildHeatmapGradientStyles(colors, isDarkMode);
  const style = document.createElement("style");
  style.setAttribute("data-cmux-heatmap-gradient", "true");
  style.textContent = cssText;
  return style;
}

export function injectHeatmapGradientStyles(
  colors: HeatmapColorSettings = DEFAULT_HEATMAP_COLORS,
  isDarkMode = false
): () => void {
  // Remove existing style element if present
  const existing = document.querySelector(
    'style[data-cmux-heatmap-gradient="true"]'
  );
  if (existing) {
    existing.remove();
  }

  const style = buildHeatmapGradientStyleElement(colors, isDarkMode);
  document.head.appendChild(style);

  return () => {
    style.remove();
  };
}
