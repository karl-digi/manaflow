import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useRouterState, type RouterState } from "@tanstack/react-router";

export type NavigationHistoryEntry = {
  id: string;
  label: string;
  subtitle?: string | null;
  pathname: string;
  searchStr: string;
  hash: string;
  href: string;
  timestamp: number;
};

type NavigationHistoryContextValue = {
  entries: NavigationHistoryEntry[];
  currentIndex: number;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  goToIndex: (index: number) => void;
};

const MAX_HISTORY_ENTRIES = 50;

const NavigationHistoryContext = createContext<
  NavigationHistoryContextValue | undefined
>(undefined);

type NavigationHistoryProviderProps = {
  children: ReactNode;
};

export function NavigationHistoryProvider({
  children,
}: NavigationHistoryProviderProps) {
  const router = useRouter();
  const history = router.history;
  const location = useRouterState({
    select: (state) => state.location,
  });

  const [historyState, setHistoryState] = useState<{
    entries: NavigationHistoryEntry[];
    index: number;
  }>(() => {
    const initialEntry = buildHistoryEntry(location);
    return { entries: [initialEntry], index: 0 };
  });

  const historyStateRef = useRef(historyState);
  useEffect(() => {
    historyStateRef.current = historyState;
  }, [historyState]);

  useEffect(() => {
    setHistoryState((prev) => {
      const entryKey = resolveLocationKey(location);
      const existingIndex = prev.entries.findIndex(
        (entry) => entry.id === entryKey
      );

      if (existingIndex !== -1) {
        const existingEntry = prev.entries[existingIndex];
        const updatedEntry =
          existingEntry.href === location.href
            ? existingEntry
            : buildHistoryEntry(location, entryKey);

        if (
          existingEntry === updatedEntry &&
          existingIndex === prev.index
        ) {
          return prev;
        }

        const nextEntries =
          existingEntry === updatedEntry
            ? prev.entries
            : prev.entries.map((entry, idx) =>
                idx === existingIndex ? updatedEntry : entry
              );

        return {
          entries: nextEntries,
          index: existingIndex,
        };
      }

      const nextEntry = buildHistoryEntry(location, entryKey);
      const trimmedEntries = prev.entries.slice(0, prev.index + 1);
      trimmedEntries.push(nextEntry);

      let normalizedEntries = trimmedEntries;
      if (trimmedEntries.length > MAX_HISTORY_ENTRIES) {
        normalizedEntries = trimmedEntries.slice(
          trimmedEntries.length - MAX_HISTORY_ENTRIES
        );
      }

      const newIndex = normalizedEntries.length - 1;
      return {
        entries: normalizedEntries,
        index: newIndex,
      };
    });
  }, [location]);

  const goBack = useCallback(() => {
    if (historyStateRef.current.index <= 0) return;
    history.back();
  }, [history]);

  const goForward = useCallback(() => {
    const { entries, index } = historyStateRef.current;
    if (index >= entries.length - 1) return;
    history.forward();
  }, [history]);

  const goToIndex = useCallback(
    (targetIndex: number) => {
      const currentIndex = historyStateRef.current.index;
      if (targetIndex === currentIndex) return;
      history.go(targetIndex - currentIndex);
    },
    [history]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || !event.ctrlKey || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "[") {
        event.preventDefault();
        goBack();
      } else if (key === "]") {
        event.preventDefault();
        goForward();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [goBack, goForward]);

  useEffect(() => {
    const cmux = typeof window === "undefined" ? undefined : window.cmux;
    if (!cmux?.on) return;

    const unsubs = [
      cmux.on("shortcut:navigate-back", () => {
        goBack();
      }),
      cmux.on("shortcut:navigate-forward", () => {
        goForward();
      }),
    ];

    return () => {
      for (const off of unsubs) {
        try {
          off?.();
        } catch {
          // no-op
        }
      }
    };
  }, [goBack, goForward]);

  const contextValue = useMemo<NavigationHistoryContextValue>(() => {
    return {
      entries: historyState.entries,
      currentIndex: historyState.index,
      canGoBack: historyState.index > 0,
      canGoForward: historyState.index < historyState.entries.length - 1,
      goBack,
      goForward,
      goToIndex,
    };
  }, [historyState, goBack, goForward, goToIndex]);

  return (
    <NavigationHistoryContext.Provider value={contextValue}>
      {children}
    </NavigationHistoryContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNavigationHistory(): NavigationHistoryContextValue {
  const context = useContext(NavigationHistoryContext);
  if (!context) {
    throw new Error(
      "useNavigationHistory must be used within a NavigationHistoryProvider"
    );
  }
  return context;
}

function buildHistoryEntry(
  location: RouterState["location"],
  key = resolveLocationKey(location)
): NavigationHistoryEntry {
  const { label, subtitle } = describePath(location.pathname);
  return {
    id: key,
    label,
    subtitle,
    pathname: location.pathname,
    searchStr: location.searchStr,
    hash: location.hash,
    href: location.href,
    timestamp: Date.now(),
  };
}

function resolveLocationKey(location: RouterState["location"]): string {
  const state = location.state as {
    __TSR_key?: string;
    key?: string;
  };
  return state?.__TSR_key ?? state?.key ?? location.href;
}

function describePath(pathname: string): {
  label: string;
  subtitle?: string | null;
} {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { label: "Home", subtitle: null };
  }

  const [team, ...rest] = segments;
  if (rest.length === 0) {
    return {
      label: formatSegment(team),
      subtitle: null,
    };
  }

  return {
    label: rest.map(formatSegment).join(" / ") || "Untitled",
    subtitle: team ? `@${team}` : null,
  };
}

function formatSegment(segment: string): string {
  if (!segment) return "/";
  const friendlyNames: Record<string, string> = {
    dashboard: "Dashboard",
    environments: "Environments",
    settings: "Settings",
    prs: "Pull Requests",
    workspaces: "Workspaces",
    task: "Task",
    diff: "Diff",
    logs: "Logs",
  };

  const normalized = segment.toLowerCase();
  if (friendlyNames[normalized]) {
    return friendlyNames[normalized];
  }

  const cleaned = segment.replace(/[-_]/g, " ");
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}
