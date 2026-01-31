export type WorkspaceTabStyle =
  | "minimal-pill"
  | "underline-rail"
  | "segmented-slate"
  | "ghost-stack"
  | "border-strip"
  | "document-strip";

export type WorkspaceTabStyleOption = {
  value: WorkspaceTabStyle;
  label: string;
};

export const WORKSPACE_TAB_STYLE_OPTIONS: WorkspaceTabStyleOption[] = [
  { value: "minimal-pill", label: "Minimal pill rect" },
  { value: "underline-rail", label: "Underline rail" },
  { value: "segmented-slate", label: "Segmented slate" },
  { value: "ghost-stack", label: "Ghost stack" },
  { value: "border-strip", label: "Border strip" },
  { value: "document-strip", label: "Document strip" },
];

export const DEFAULT_WORKSPACE_TAB_STYLE: WorkspaceTabStyle = "minimal-pill";

export const WORKSPACE_TAB_STYLE_CLASSES: Record<
  WorkspaceTabStyle,
  {
    tab: string;
    active: string;
    inactive: string;
  }
> = {
  "minimal-pill": {
    tab: "border border-transparent",
    active:
      "border-neutral-300 bg-neutral-100 text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100",
    inactive:
      "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/70 dark:hover:text-neutral-100",
  },
  "underline-rail": {
    tab: "border-b-2 border-transparent",
    active:
      "border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100",
    inactive:
      "text-neutral-500 hover:border-neutral-300 hover:text-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:text-neutral-100",
  },
  "segmented-slate": {
    tab: "border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/60",
    active:
      "border-neutral-300 bg-white text-neutral-900 shadow-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100",
    inactive:
      "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/70 dark:hover:text-neutral-100",
  },
  "ghost-stack": {
    tab: "border-l-2 border-transparent",
    active:
      "bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100 border-l-neutral-300 dark:border-l-neutral-700",
    inactive:
      "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/70 dark:hover:text-neutral-100",
  },
  "border-strip": {
    tab: "border border-neutral-300 bg-neutral-50 -mb-px dark:border-neutral-700 dark:bg-neutral-900/60",
    active:
      "border-neutral-400 border-b-transparent bg-white text-neutral-900 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100",
    inactive:
      "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/70 dark:hover:text-neutral-100",
  },
  "document-strip": {
    tab: "border border-neutral-300 bg-neutral-100 -mb-px dark:border-neutral-700 dark:bg-neutral-900",
    active:
      "border-neutral-300 border-b-transparent bg-white text-neutral-900 shadow-sm dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-100",
    inactive:
      "text-neutral-600 hover:bg-neutral-200 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800/70 dark:hover:text-neutral-100",
  },
};
