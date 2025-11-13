import type {
  AnyRouteMatch,
  RouterState,
} from "@tanstack/react-router";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RouteTitleStaticData } from "@/routes/route-metadata";
import { getRouteTitleDescriptor } from "@/routes/route-titles";

const MAX_HISTORY_ENTRIES = 15;
const DEFAULT_HISTORY_TITLE = "cmux";

export type NavigationHistoryEntry = {
  key: string;
  href: string;
  pathname: string;
  search: string;
  hash: string;
  title: string;
  timestamp: number;
};

interface NavigationHistoryContextValue {
  entries: NavigationHistoryEntry[];
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

const NavigationHistoryContext =
  createContext<NavigationHistoryContextValue | null>(null);

export function NavigationHistoryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { location, matches } = useRouterState({
    select: (state) => ({
      location: state.location,
      matches: state.matches,
    }),
  });

  const [entries, setEntries] = useState<NavigationHistoryEntry[]>([]);
  const lastKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!location) return;
    const locationKey = getLocationKey(location);
    if (!locationKey || locationKey === lastKeyRef.current) {
      return;
    }

    lastKeyRef.current = locationKey;

    const nextEntry: NavigationHistoryEntry = {
      key: locationKey,
      href: location.href,
      pathname: location.pathname,
      search: location.searchStr,
      hash: location.hash,
      title: resolveTitle(matches),
      timestamp: Date.now(),
    };

    setEntries((prev) => {
      const trimmed = prev.length >= MAX_HISTORY_ENTRIES ? prev.slice(1) : prev;
      const previous = trimmed[trimmed.length - 1];
      if (previous?.key === nextEntry.key) {
        return [...trimmed.slice(0, -1), nextEntry];
      }
      return [...trimmed, nextEntry];
    });
  }, [location, matches]);

  const canGoBack = router.history.canGoBack();
  const canGoForward = computeCanGoForward(router.history.length, location);

  const goBack = useCallback(() => {
    if (router.history.canGoBack()) {
      router.history.back();
    }
  }, [router]);

  const goForward = useCallback(() => {
    if (computeCanGoForward(router.history.length, location)) {
      router.history.forward();
    }
  }, [router, location]);

  const value = useMemo<NavigationHistoryContextValue>(
    () => ({
      entries,
      canGoBack,
      canGoForward,
      goBack,
      goForward,
    }),
    [entries, canGoBack, canGoForward, goBack, goForward]
  );

  return (
    <NavigationHistoryContext.Provider value={value}>
      {children}
    </NavigationHistoryContext.Provider>
  );
}

export function useNavigationHistory() {
  const context = useContext(NavigationHistoryContext);
  if (!context) {
    throw new Error(
      "useNavigationHistory must be used within NavigationHistoryProvider"
    );
  }
  return context;
}

function getLocationKey(location: RouterState["location"]) {
  const state =
    location && typeof location === "object"
      ? (location as { state?: unknown }).state
      : undefined;
  if (state && typeof state === "object") {
    const typed = state as { key?: string; __TSR_key?: string };
    return typed.key ?? typed.__TSR_key ?? buildHref(location);
  }
  return buildHref(location);
}

function buildHref(location: RouterState["location"]) {
  return location.href;
}

function resolveTitle(matches: AnyRouteMatch[]): string {
  const match = matches[matches.length - 1];
  if (!match) return DEFAULT_HISTORY_TITLE;

  const staticData =
    (match.staticData as RouteTitleStaticData | undefined) ||
    getRouteTitleDescriptor(match.fullPath);
  if (staticData?.formatTitle) {
    try {
      const formatted = staticData.formatTitle({
        params: match.params ?? {},
        search: match.search,
        pathname: match.pathname,
      });
      if (formatted && typeof formatted === "string") {
        return formatted;
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Failed to format route title", error);
      }
    }
  }
  if (staticData?.title) {
    return staticData.title;
  }
  return humanizePath(match.fullPath ?? match.pathname);
}

function humanizePath(path?: string) {
  if (!path) return DEFAULT_HISTORY_TITLE;
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment
        .replace(/^\$/, "")
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase())
    )
    .join(" · ");
}

function computeCanGoForward(
  historyLength: number,
  location: RouterState["location"]
) {
  const state = location?.state;
  if (!state || typeof state !== "object") {
    return false;
  }
  const index = (state as { __TSR_index?: unknown }).__TSR_index;
  if (typeof index !== "number") {
    return false;
  }
  return index < historyLength - 1;
}
