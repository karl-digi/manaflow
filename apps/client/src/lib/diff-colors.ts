export const diffColorPalette = {
  light: {
    addition: {
      lineBackground: "#dafbe1",
      gutterBackground: "#b8f0c8",
      textBackground: "#b8f0c8",
      lineNumberForeground: "#116329",
    },
    deletion: {
      lineBackground: "#ffebe9",
      gutterBackground: "#ffdcd7",
      textBackground: "#ffdcd7",
      lineNumberForeground: "#a0111f",
    },
    collapsed: {
      background: "#E9F4FF",
      foreground: "#4b5563",
    },
    mergeSpacerBackground: "#f6f8fa",
  },
  dark: {
    addition: {
      lineBackground: "#2ea04326",
      gutterBackground: "#3fb9504d",
      textBackground: "#2ea04326",
      lineNumberForeground: "#7ee787",
    },
    deletion: {
      lineBackground: "#f851491a",
      gutterBackground: "#f851494d",
      textBackground: "#f851491a",
      lineNumberForeground: "#ff7b72",
    },
    collapsed: {
      background: "#1f2733",
      foreground: "#e5e7eb",
    },
    mergeSpacerBackground: "rgba(148, 163, 184, 0.18)",
  },
} as const;

export type DiffColorPalette = typeof diffColorPalette;
