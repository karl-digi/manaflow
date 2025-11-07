import { Dropdown } from "@/components/ui/dropdown";
import {
  useNavigationHistory,
  type NavigationHistoryEntry,
} from "@/contexts/navigation-history/NavigationHistoryContext";
import { isElectron } from "@/lib/electron";
import clsx from "clsx";
import {
  ChevronLeft,
  ChevronRight,
  History as HistoryIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const buttonBaseClasses =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-900";

type IndexedHistoryEntry = {
  entry: NavigationHistoryEntry;
  index: number;
};

export function SidebarHistoryControls() {
  const {
    entries,
    currentIndex,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    goToIndex,
  } = useNavigationHistory();

  const [menuOpen, setMenuOpen] = useState(false);

  const openHistoryMenu = useCallback(() => {
    setMenuOpen(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || !event.ctrlKey || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        openHistoryMenu();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [openHistoryMenu]);

  useEffect(() => {
    if (!isElectron) return;
    const cmux = typeof window === "undefined" ? undefined : window.cmux;
    if (!cmux?.on) return;
    const off = cmux.on("shortcut:navigate-history", () => {
      openHistoryMenu();
    });
    return () => {
      try {
        off?.();
      } catch {
        // ignore
      }
    };
  }, [openHistoryMenu]);

  const handleSelectIndex = useCallback(
    (index: number) => {
      goToIndex(index);
      setMenuOpen(false);
    },
    [goToIndex]
  );

  const currentEntry = entries[currentIndex];

  const backEntries = useMemo<IndexedHistoryEntry[]>(() => {
    return entries
      .slice(0, currentIndex)
      .map((entry, index) => ({ entry, index }))
      .slice(-10)
      .reverse();
  }, [entries, currentIndex]);

  const forwardEntries = useMemo<IndexedHistoryEntry[]>(() => {
    return entries
      .slice(currentIndex + 1)
      .map((entry, idx) => ({
        entry,
        index: currentIndex + 1 + idx,
      }))
      .slice(0, 10);
  }, [entries, currentIndex]);

  const historyTriggerClasses = clsx(
    buttonBaseClasses,
    "w-auto min-w-[84px] gap-1 px-2"
  );

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={goBack}
        disabled={!canGoBack}
        className={buttonBaseClasses}
        title="Back (⌘⌃[)"
        aria-label="Go back"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={goForward}
        disabled={!canGoForward}
        className={buttonBaseClasses}
        title="Forward (⌘⌃])"
        aria-label="Go forward"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <Dropdown.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Dropdown.Trigger
          className={historyTriggerClasses}
          title="History (⌘⌃Y)"
          aria-label="Open history"
        >
          <HistoryIcon className="h-3.5 w-3.5" />
          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-200">
            History
          </span>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Positioner
            side={isElectron ? "right" : "bottom"}
            align="start"
            sideOffset={10}
          >
            <Dropdown.Popup className="w-[280px]">
              <Dropdown.Arrow />
              {currentEntry ? (
                <div className="border-b border-neutral-200 px-3 pb-3 pt-2 text-left dark:border-neutral-800">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                    Current
                  </div>
                  <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                    {currentEntry.label}
                  </div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">
                    {formatEntrySubtitle(currentEntry)}
                  </div>
                </div>
              ) : null}
              {backEntries.length === 0 && forwardEntries.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  Navigate around the app to build a recent history list.
                </p>
              ) : (
                <>
                  <HistoryDropdownSection
                    title="Back"
                    items={backEntries}
                    onSelect={handleSelectIndex}
                  />
                  <HistoryDropdownSection
                    title="Forward"
                    items={forwardEntries}
                    onSelect={handleSelectIndex}
                  />
                </>
              )}
            </Dropdown.Popup>
          </Dropdown.Positioner>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  );
}

type HistoryDropdownSectionProps = {
  title: string;
  items: IndexedHistoryEntry[];
  onSelect: (index: number) => void;
};

function HistoryDropdownSection({
  title,
  items,
  onSelect,
}: HistoryDropdownSectionProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="py-1">
      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        {title}
      </div>
      <div className="flex flex-col">
        {items.map(({ entry, index }) => (
          <Dropdown.Item
            key={`${entry.id}-${index}`}
            onClick={() => onSelect(index)}
            className="flex w-full flex-col items-start gap-0.5 py-2 pl-3 pr-4 text-left"
          >
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
              {entry.label}
            </span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {formatEntrySubtitle(entry)}
            </span>
          </Dropdown.Item>
        ))}
      </div>
    </div>
  );
}

function formatEntrySubtitle(entry: NavigationHistoryEntry): string {
  const search = entry.searchStr ?? "";
  const hash = entry.hash ? `#${entry.hash}` : "";
  const path = entry.pathname || "/";
  const suffix = `${search}${hash}`;
  if (entry.subtitle) {
    return suffix ? `${entry.subtitle} • ${path}${suffix}` : entry.subtitle;
  }
  return `${path}${suffix}`;
}
