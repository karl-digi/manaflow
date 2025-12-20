import { useCommandBar } from "@/contexts/command-bar/useCommandBar";
import { Home, Plus, Search, Settings, Users } from "lucide-react";
import type { CSSProperties } from "react";

export function QuickBar() {
  const { openCommandBar } = useCommandBar();

  return (
    <div
      className="min-h-[36px] border-b border-neutral-200/70 dark:border-neutral-800/50 flex items-center justify-center relative select-none px-3"
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
    >
      {/* Traffic light placeholder - will be handled by macOS */}
      <div
        className="absolute left-0 w-20 h-full"
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
      />

      {/* Quick bar search button */}
      <button
        type="button"
        onClick={openCommandBar}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors cursor-pointer min-w-[280px] max-w-[400px]"
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
      >
        {/* Left icons */}
        <div className="flex items-center gap-1.5 text-neutral-400 dark:text-neutral-500">
          <Home className="h-3.5 w-3.5" />
          <Plus className="h-3.5 w-3.5" />
          <Users className="h-3.5 w-3.5" />
          <Settings className="h-3.5 w-3.5" />
        </div>

        {/* Divider */}
        <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-700" />

        {/* Search section */}
        <div className="flex items-center gap-2 flex-1">
          <Search className="h-3.5 w-3.5 text-neutral-400 dark:text-neutral-500" />
          <span className="text-sm text-neutral-400 dark:text-neutral-500">
            Search...
          </span>
        </div>

        {/* Keyboard shortcut */}
        <div className="flex items-center gap-0.5">
          <kbd className="px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-700 rounded border border-neutral-200 dark:border-neutral-600">
            ⌘
          </kbd>
          <kbd className="px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-700 rounded border border-neutral-200 dark:border-neutral-600">
            K
          </kbd>
        </div>
      </button>
    </div>
  );
}
