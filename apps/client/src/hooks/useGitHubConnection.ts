import { useUser } from "@stackframe/react";
import { useCallback, useEffect, useState } from "react";

interface GitHubConnectionState {
  /** Whether we're currently checking the connection status */
  isLoading: boolean;
  /** Whether the user has a connected GitHub OAuth account */
  isConnected: boolean;
  /** Error if checking connection failed */
  error: string | null;
  /** Re-check the connection status */
  refresh: () => Promise<void>;
}

/**
 * Hook to check if the current user has a GitHub OAuth account connected via Stack Auth.
 * This is different from the GitHub App installation - this is the OAuth connection
 * that allows us to get the user's GitHub identity and access token.
 */
export function useGitHubConnection(): GitHubConnectionState {
  const user = useUser({ or: "return-null" });
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkConnection = useCallback(async () => {
    if (!user) {
      setIsLoading(false);
      setIsConnected(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check if user has a connected GitHub account
      // Using { or: 'return-null' } so it doesn't redirect
      const githubAccount = await user.getConnectedAccount("github", {
        or: "return-null",
      });
      setIsConnected(githubAccount !== null);
    } catch (err) {
      console.error("[useGitHubConnection] Failed to check connection:", err);
      setError(
        err instanceof Error ? err.message : "Failed to check GitHub connection"
      );
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void checkConnection();
  }, [checkConnection]);

  return {
    isLoading,
    isConnected,
    error,
    refresh: checkConnection,
  };
}
