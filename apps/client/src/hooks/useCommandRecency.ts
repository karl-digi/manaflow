import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hook to track and persist command palette item recency
 * Uses localStorage to persist across sessions
 */

const STORAGE_KEY = "cmux:command-recency";
const MAX_STORED_ITEMS = 100;

interface RecencyStore {
  [key: string]: number; // value -> timestamp
}

function loadRecencyStore(): Map<string, number> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return new Map();
    }

    const parsed: RecencyStore = JSON.parse(stored);
    return new Map(Object.entries(parsed));
  } catch (error) {
    console.error("Failed to load command recency store:", error);
    return new Map();
  }
}

function saveRecencyStore(store: Map<string, number>): void {
  try {
    // Convert Map to object and keep only the most recent MAX_STORED_ITEMS
    const entries = Array.from(store.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by timestamp descending
      .slice(0, MAX_STORED_ITEMS);

    const obj: RecencyStore = Object.fromEntries(entries);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch (error) {
    console.error("Failed to save command recency store:", error);
  }
}

export function useCommandRecency() {
  // Use ref to avoid re-renders when recency changes
  const recencyRef = useRef<Map<string, number>>(loadRecencyStore());
  const [, forceUpdate] = useState({});

  // Save to localStorage when component unmounts or page unloads
  useEffect(() => {
    const currentRecency = recencyRef.current;
    const handleUnload = () => {
      saveRecencyStore(currentRecency);
    };

    window.addEventListener("beforeunload", handleUnload);

    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      saveRecencyStore(currentRecency);
    };
  }, []);

  /**
   * Record that a command was selected
   */
  const recordSelection = useCallback((value: string) => {
    recencyRef.current.set(value, Date.now());

    // Trigger a re-render so the filter gets the updated recency map
    forceUpdate({});

    // Debounced save - don't save on every selection to avoid excessive writes
    // The beforeunload/unmount handlers will ensure data isn't lost
  }, []);

  /**
   * Get the current recency scores map
   */
  const getRecencyScores = useCallback((): Map<string, number> => {
    return recencyRef.current;
  }, []);

  /**
   * Clear all recency data
   */
  const clearRecency = useCallback(() => {
    recencyRef.current.clear();
    saveRecencyStore(recencyRef.current);
    forceUpdate({});
  }, []);

  return {
    recordSelection,
    getRecencyScores,
    clearRecency,
  };
}
