import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons/github";
import { ArrowRight, Check, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@cmux/convex/api";
import { useMutation, useQuery } from "convex/react";
import { env } from "@/client-env";

interface GitHubConnectStepProps {
  teamSlugOrId: string;
  onNext: () => void;
  onSkip: () => void;
  onGitHubConnected: () => void;
  hasConnection: boolean;
}

export function GitHubConnectStep({
  teamSlugOrId,
  onNext,
  onSkip,
  onGitHubConnected,
  hasConnection,
}: GitHubConnectStepProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [localHasConnection, setLocalHasConnection] = useState(hasConnection);

  const connections = useQuery(api.github.listProviderConnections, {
    teamSlugOrId,
  });
  const mintInstallState = useMutation(api.github_app.mintInstallState);

  useEffect(() => {
    if (connections && connections.length > 0 && !localHasConnection) {
      setLocalHasConnection(true);
      onGitHubConnected();
    }
  }, [connections, localHasConnection, onGitHubConnected]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const { state } = await mintInstallState({
        teamSlugOrId,
        returnUrl: window.location.href,
      });

      const githubAppSlug = env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? "cmux-dev";
      const installUrl = new URL(
        `https://github.com/apps/${githubAppSlug}/installations/new`
      );
      installUrl.searchParams.set("state", state);

      const width = 600;
      const height = 800;
      const left = Math.max(0, (window.screen.width - width) / 2);
      const top = Math.max(0, (window.screen.height - height) / 2);

      const popup = window.open(
        installUrl.href,
        "github-install",
        `width=${width},height=${height},left=${left},top=${top},popup=yes`
      );

      if (!popup) {
        throw new Error(
          "Failed to open popup. Please allow popups for this site."
        );
      }

      const handleMessage = (event: MessageEvent) => {
        if (
          event.origin === window.location.origin &&
          event.data?.type === "cmux/github-install-complete"
        ) {
          window.removeEventListener("message", handleMessage);
          setLocalHasConnection(true);
          onGitHubConnected();
          setIsConnecting(false);
        }
      };

      window.addEventListener("message", handleMessage);

      const checkInterval = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkInterval);
          window.removeEventListener("message", handleMessage);
          setIsConnecting(false);
        }
      }, 500);
    } catch (error) {
      console.error("Failed to connect GitHub:", error);
      setIsConnecting(false);
    }
  }, [teamSlugOrId, mintInstallState, onGitHubConnected]);

  return (
    <div className="flex flex-col">
      <div className="mb-4">
        <h2 className="mb-1 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
          Connect GitHub
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Connect your GitHub account to access repositories.
        </p>
      </div>

      {localHasConnection ? (
        <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50">
          <div className="flex items-center gap-3 mb-2">
            <Check className="h-4 w-4 text-green-600" />
            <span className="font-medium text-neutral-900 dark:text-neutral-100">
              Connected
            </span>
          </div>
          {connections && connections.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {connections.map((conn) => (
                <div
                  key={conn.installationId}
                  className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400"
                >
                  <GitHubIcon className="h-4 w-4" />
                  <span>{conn.accountLogin}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <Button
          size="sm"
          onClick={handleConnect}
          disabled={isConnecting}
          className="mb-4 gap-2"
        >
          <GitHubIcon className="h-4 w-4" />
          {isConnecting ? "Connecting..." : "Connect GitHub"}
          <ExternalLink className="h-4 w-4" />
        </Button>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onSkip} disabled={isConnecting} size="sm">
          Skip
        </Button>
        {localHasConnection && (
          <Button onClick={onNext} size="sm" className="gap-1.5">
            Continue
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
