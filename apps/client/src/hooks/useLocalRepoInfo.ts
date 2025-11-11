import { useEffect, useState } from "react";
import { useSocket } from "@/contexts/socket/use-socket";
import type { LocalRepoInfoResponse } from "@cmux/shared";

interface LocalRepoState {
  info: LocalRepoInfoResponse["info"] | null;
  loading: boolean;
  error: string | null;
}

export function useLocalRepoInfo(path: string | null | undefined) {
  const { socket } = useSocket();
  const [state, setState] = useState<LocalRepoState>({
    info: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!socket || !path) {
      setState({ info: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((prev) => ({
      info: prev.info && prev.info.path === path ? prev.info : null,
      loading: true,
      error: null,
    }));

    socket.emit(
      "local-repo-info",
      { path },
      (response: LocalRepoInfoResponse) => {
        if (cancelled) return;
        if (response.success && response.info) {
          setState({ info: response.info, loading: false, error: null });
        } else {
          setState({
            info: null,
            loading: false,
            error: response.error || "Failed to inspect repository",
          });
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [socket, path]);

  return state;
}
