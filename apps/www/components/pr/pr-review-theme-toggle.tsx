'use client';

import { Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";

import { usePrReviewTheme } from "./pr-review-theme-provider";

export function PrReviewThemeToggle() {
  const { theme, toggleTheme } = usePrReviewTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500",
        "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400 hover:bg-neutral-100 hover:text-neutral-900",
        "dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      )}
    >
      {isDark ? (
        <Sun className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Moon className="h-3.5 w-3.5" aria-hidden />
      )}
      <span>{isDark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
