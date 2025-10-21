export type DiffThemeMode = "light" | "dark";

export interface DiffSideColors {
  lineBackground: string;
  textBackground: string;
  gutterBackground: string;
  lineNumber: string;
}

export interface DiffCollapsedColors {
  background: string;
  text: string;
}

export interface DiffColorPalette {
  addition: DiffSideColors;
  deletion: DiffSideColors;
  collapsed: DiffCollapsedColors;
}

export const DIFF_COLOR_PALETTE: Record<DiffThemeMode, DiffColorPalette> = {
  light: {
    addition: {
      lineBackground: "#dafbe1",
      textBackground: "#b8f0c8",
      gutterBackground: "#b8f0c8",
      lineNumber: "#116329",
    },
    deletion: {
      lineBackground: "#ffebe9",
      textBackground: "#ffdcd7",
      gutterBackground: "#ffdcd7",
      lineNumber: "#a0111f",
    },
    collapsed: {
      background: "#E9F4FF",
      text: "#4b5563",
    },
  },
  dark: {
    addition: {
      lineBackground: "#2ea04326",
      textBackground: "#2ea04326",
      gutterBackground: "#3fb9504d",
      lineNumber: "#7ee787",
    },
    deletion: {
      lineBackground: "#f851491a",
      textBackground: "#f851491a",
      gutterBackground: "#f851494d",
      lineNumber: "#ff7b72",
    },
    collapsed: {
      background: "#1f2733",
      text: "#e5e7eb",
    },
  },
};

export function resolveDiffThemeMode(theme: string | undefined): DiffThemeMode {
  return theme === "dark" ? "dark" : "light";
}

export function resolveDiffColorPalette(theme: string | undefined): DiffColorPalette {
  return DIFF_COLOR_PALETTE[resolveDiffThemeMode(theme)];
}
