import { useEffect, useMemo, useState } from "react";
import { useSocket } from "@/contexts/socket/use-socket";
import { useDebouncedValue } from "./useDebouncedValue";
import type { LocalPathSuggestion } from "@cmux/shared";

interface SuggestionsState {
  suggestions: LocalPathSuggestion[];
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: SuggestionsState = {
  suggestions: [],
  loading: false,
  error: null,
};

export function useLocalPathSuggestions(
  query: string,
  options?: { enabled?: boolean; debounceMs?: number; limit?: number }
) {
  const { socket } = useSocket();
  const [state, setState] = useState<SuggestionsState>(INITIAL_STATE);
  const enabled = options?.enabled ?? true;
  const limit = options?.limit ?? 8;
  const debouncedQuery = useDebouncedValue(
    query,
    options?.debounceMs ?? 200
  );
  const trimmed = debouncedQuery.trim();

  useEffect(() => {
    if (!socket || !enabled || !trimmed) {
      setState((prev) => ({
        suggestions: trimmed ? prev.suggestions : [],
        loading: false,
        error: null,
      }));
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    socket.emit(
      "local-path-suggestions",
      { input: trimmed, limit },
      (response?: {
        ok: boolean;
        suggestions?: LocalPathSuggestion[];
        error?: string;
      }) => {
        if (cancelled) return;
        if (response?.ok && response.suggestions) {
          setState({
            suggestions: response.suggestions,
            loading: false,
            error: null,
          });
        } else {
          setState({
            suggestions: [],
            loading: false,
            error: response?.error ?? "Failed to load suggestions",
          });
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [socket, enabled, trimmed, limit]);

  return useMemo(() => {
    return {
      suggestions: state.suggestions,
      loading: state.loading,
      error: state.error,
      hasQuery: Boolean(trimmed),
    };
  }, [state, trimmed]);
}
