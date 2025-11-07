import { Dropdown } from "@/components/ui/dropdown";
import {
  NavigationHistoryEntry,
  useNavigationHistory,
} from "@/hooks/useNavigationHistory";
import { isElectron } from "@/lib/electron";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, History as HistoryIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

const MAX_MENU_ITEMS = 12;
const BUTTON_CLASS = clsx(
  "w-8 h-8 rounded-lg border border-neutral-200 dark:border-neutral-800",
  "bg-white/90 dark:bg-neutral-900/80",
  "flex items-center justify-center",
  "text-neutral-600 dark:text-neutral-300",
  "hover:bg-neutral-100 dark:hover:bg-neutral-800",
  "transition-colors duration-150",
  "disabled:opacity-40 disabled:cursor-not-allowed"
);

type HistoryOption = {
  entry: NavigationHistoryEntry;
  delta: number;
};

function formatPathPreview(entry: NavigationHistoryEntry): string {
  const suffix = `${entry.searchStr ?? ""}${entry.hash ?? ""}`;
  if (!entry.pathname) {
    return suffix || "/";
  }
  return `${entry.pathname}${suffix}`;
}

export function SidebarHistoryControls() {
  const {
    entries,
    currentEntry,
    currentIndex,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    goRelative,
  } = useNavigationHistory();
  const [historyOpen, setHistoryOpen] = useState(false);

  const hasHistoryMenuItems = entries.length > 1;

  useEffect(() => {
    if (!hasHistoryMenuItems && historyOpen) {
      setHistoryOpen(false);
    }
  }, [hasHistoryMenuItems, historyOpen]);

  const historyOptions = useMemo<HistoryOption[]>(() => {
    return entries.map((entry, index) => ({
      entry,
      delta: index - currentIndex,
    }));
  }, [entries, currentIndex]);

  const backOptions = useMemo(() => {
    return historyOptions
      .filter((option) => option.delta < 0)
      .reverse()
      .slice(0, MAX_MENU_ITEMS);
  }, [historyOptions]);

  const forwardOptions = useMemo(() => {
    return historyOptions
      .filter((option) => option.delta > 0)
      .slice(0, MAX_MENU_ITEMS);
  }, [historyOptions]);

  const closeHistoryMenu = useCallback(() => setHistoryOpen(false), []);

  const toggleHistoryMenu = useCallback(() => {
    if (!hasHistoryMenuItems) return;
    setHistoryOpen((prev) => !prev);
  }, [hasHistoryMenuItems]);

  const handleJump = useCallback(
    (delta: number) => {
      closeHistoryMenu();
      goRelative(delta);
    },
    [closeHistoryMenu, goRelative]
  );

  useEffect(() => {
    const w = typeof window === "undefined" ? undefined : window;
    if (!w) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.shiftKey) return;
      if (!event.metaKey || !event.ctrlKey) return;
      const key = event.key.toLowerCase();

      if ((key === "[" || event.code === "BracketLeft") && canGoBack) {
        event.preventDefault();
        goBack();
        return;
      }

      if ((key === "]" || event.code === "BracketRight") && canGoForward) {
        event.preventDefault();
        goForward();
        return;
      }

      if (key === "y") {
        if (!hasHistoryMenuItems) return;
        event.preventDefault();
        toggleHistoryMenu();
      }
    };

    w.addEventListener("keydown", handleKeyDown);
    return () => {
      w.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    toggleHistoryMenu,
    hasHistoryMenuItems,
  ]);

  useEffect(() => {
    const w = typeof window === "undefined" ? undefined : window;
    const cmux = w?.cmux;
    if (!cmux?.on) return;

    const offBack = cmux.on("shortcut:history-back", () => {
      goBack();
    });
    const offForward = cmux.on("shortcut:history-forward", () => {
      goForward();
    });
    const offMenu = cmux.on("shortcut:history-menu", () => {
      toggleHistoryMenu();
    });

    return () => {
      try {
        offBack?.();
      } catch {
        // ignore
      }
      try {
        offForward?.();
      } catch {
        // ignore
      }
      try {
        offMenu?.();
      } catch {
        // ignore
      }
    };
  }, [goBack, goForward, toggleHistoryMenu]);

  const containerPadding = isElectron ? "px-2" : "px-3";

  return (
    <div
      className={`${containerPadding} pt-1 pb-2 flex items-center gap-1`}
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
    >
      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={goBack}
        disabled={!canGoBack}
        aria-label="Go back"
        title="Go back (Cmd+Ctrl+[)"
      >
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={goForward}
        disabled={!canGoForward}
        aria-label="Go forward"
        title="Go forward (Cmd+Ctrl+])"
      >
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
      </button>
      <Dropdown.Root
        open={historyOpen}
        onOpenChange={(open) => {
          if (open && !hasHistoryMenuItems) return;
          setHistoryOpen(open);
        }}
      >
        <Dropdown.Trigger
          className={BUTTON_CLASS}
          disabled={!hasHistoryMenuItems}
          aria-label="Navigation history"
          title="History (Cmd+Ctrl+Y)"
        >
          <HistoryIcon className="w-4 h-4" aria-hidden="true" />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Positioner sideOffset={8} align="start">
            <Dropdown.Popup className="min-w-[220px] max-w-[280px]">
              <Dropdown.Arrow />
              <div className="px-3 py-1 text-xs font-medium text-neutral-500 dark:text-neutral-400 select-none">
                Navigation history
              </div>
              {backOptions.length === 0 && forwardOptions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400">
                  No additional history yet.
                </div>
              ) : (
                <>
                  {backOptions.length > 0 ? (
                    <>
                      <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500 select-none">
                        Recent pages
                      </div>
                      {backOptions.map((option) => (
                        <Dropdown.Item
                          key={`back-${option.entry.id}`}
                          onClick={() => handleJump(option.delta)}
                          className="flex flex-col gap-0.5"
                        >
                          <span className="text-sm font-medium leading-4">
                            {option.entry.title}
                          </span>
                          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                            {formatPathPreview(option.entry)}
                          </span>
                        </Dropdown.Item>
                      ))}
                    </>
                  ) : null}
                  {forwardOptions.length > 0 ? (
                    <>
                      <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500 select-none">
                        Forward queue
                      </div>
                      {forwardOptions.map((option) => (
                        <Dropdown.Item
                          key={`forward-${option.entry.id}`}
                          onClick={() => handleJump(option.delta)}
                          className="flex flex-col gap-0.5"
                        >
                          <span className="text-sm font-medium leading-4">
                            {option.entry.title}
                          </span>
                          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                            {formatPathPreview(option.entry)}
                          </span>
                        </Dropdown.Item>
                      ))}
                    </>
                  ) : null}
                </>
              )}
            </Dropdown.Popup>
          </Dropdown.Positioner>
        </Dropdown.Portal>
      </Dropdown.Root>
      {currentEntry ? (
        <div className="ml-1 min-w-0 flex-1 truncate">
          <div className="text-[13px] font-medium text-neutral-800 dark:text-neutral-100 truncate">
            {currentEntry.title}
          </div>
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
            {formatPathPreview(currentEntry)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default SidebarHistoryControls;
