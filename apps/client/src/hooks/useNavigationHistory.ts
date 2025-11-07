import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

const DEFAULT_MAX_ENTRIES = 50;

type LocationLike = {
  pathname: string;
  searchStr?: string;
  hash?: string;
  key?: string;
  href?: string;
};

export interface NavigationHistoryEntry {
  id: string;
  pathname: string;
  searchStr: string;
  hash: string;
  href: string;
  title: string;
  timestamp: number;
}

interface NavigationHistoryState {
  entries: NavigationHistoryEntry[];
  index: number;
}

function formatFallbackTitle(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "Home";
  }
  const segments = pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return "Home";
  }
  const last = segments[segments.length - 1] ?? "";
  return last
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeHref(location: LocationLike): string {
  const search = location.searchStr ?? "";
  const hash = location.hash ?? "";
  if (location.href) return location.href;
  return `${location.pathname}${search}${hash}`;
}

function createEntry(location: LocationLike): NavigationHistoryEntry {
  const href = normalizeHref(location);
  const title =
    typeof document !== "undefined" && document.title
      ? document.title
      : formatFallbackTitle(location.pathname);

  return {
    id: location.key ?? href,
    pathname: location.pathname,
    searchStr: location.searchStr ?? "",
    hash: location.hash ?? "",
    href,
    title,
    timestamp: Date.now(),
  };
}

export function useNavigationHistory(options?: {
  maxEntries?: number;
}): {
  entries: NavigationHistoryEntry[];
  currentEntry: NavigationHistoryEntry | null;
  currentIndex: number;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  goRelative: (delta: number) => void;
} {
  const { maxEntries = DEFAULT_MAX_ENTRIES } = options ?? {};
  const location = useRouterState({
    select: (state) => state.location,
  }) as LocationLike;

  const [historyState, setHistoryState] = useState<NavigationHistoryState>(() => {
    return {
      entries: [createEntry(location)],
      index: 0,
    };
  });

  const locationPathname = location.pathname;
  const locationHash = location.hash;
  const locationHref = location.href;
  const locationKey = location.key;
  const locationSearchStr = location.searchStr;

  useEffect(() => {
    const snapshot: LocationLike = {
      pathname: locationPathname,
      hash: locationHash,
      href: locationHref,
      key: locationKey,
      searchStr: locationSearchStr,
    };

    setHistoryState((prev) => {
      const nextEntry = createEntry(snapshot);
      const existingIndex = prev.entries.findIndex(
        (entry) => entry.id === nextEntry.id
      );

      if (existingIndex !== -1) {
        const updatedEntries = [...prev.entries];
        updatedEntries[existingIndex] = nextEntry;
        return {
          entries: updatedEntries,
          index: existingIndex,
        };
      }

      const trimmedEntries = prev.entries.slice(0, prev.index + 1);
      trimmedEntries.push(nextEntry);

      let nextIndex = trimmedEntries.length - 1;
      let nextEntries = trimmedEntries;
      if (trimmedEntries.length > maxEntries) {
        const overflow = trimmedEntries.length - maxEntries;
        nextEntries = trimmedEntries.slice(overflow);
        nextIndex -= overflow;
      }

      return {
        entries: nextEntries,
        index: nextIndex,
      };
    });
  }, [
    locationHash,
    locationHref,
    locationKey,
    locationPathname,
    locationSearchStr,
    maxEntries,
  ]);

  const currentEntry = historyState.entries[historyState.index] ?? null;
  const canGoBack = historyState.index > 0;
  const canGoForward =
    historyState.index < historyState.entries.length - 1 &&
    historyState.entries.length > 0;

  const goRelative = useCallback((delta: number) => {
    if (!delta) return;
    if (typeof window === "undefined") return;
    window.history.go(delta);
  }, []);

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    goRelative(-1);
  }, [canGoBack, goRelative]);

  const goForward = useCallback(() => {
    if (!canGoForward) return;
    goRelative(1);
  }, [canGoForward, goRelative]);

  return {
    entries: historyState.entries,
    currentEntry,
    currentIndex: historyState.index,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    goRelative,
  };
}
