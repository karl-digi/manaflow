import { Search } from "lucide-react";
import type { CSSProperties } from "react";

export function QuickBar() {
  const handleClick = () => {
    // Dispatch Cmd+K / Ctrl+K to trigger the CommandBar
    const isMac =
      typeof navigator !== "undefined" &&
      navigator.platform.toUpperCase().includes("MAC");
    const event = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
  };

  return (
    <div
      className="h-12 border-b border-neutral-200/70 dark:border-neutral-800/50 flex items-center justify-center px-4 select-none bg-neutral-50/50 dark:bg-neutral-900/50"
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
    >
      {/* Traffic light placeholder - will be handled by macOS */}
      <div
        className="absolute left-0 w-20 h-full"
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
      />

      {/* Search bar */}
      <button
        type="button"
        onClick={handleClick}
        className="flex items-center gap-2 px-3 py-1.5 w-full max-w-md bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm text-neutral-500 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-750 transition-colors cursor-pointer"
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
      >
        <Search className="h-4 w-4 text-neutral-400 dark:text-neutral-500" />
        <span className="flex-1 text-left">Search...</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-700 rounded border border-neutral-200 dark:border-neutral-600">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>
    </div>
  );
}
