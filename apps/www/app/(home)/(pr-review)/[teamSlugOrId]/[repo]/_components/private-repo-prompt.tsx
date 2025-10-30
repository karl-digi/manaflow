"use client";

import { useCallback, useState } from "react";
import { AlertCircle, Github } from "lucide-react";

interface PrivateRepoPromptProps {
  teamSlugOrId: string;
  repo: string;
  githubOwner: string;
  githubAppSlug?: string;
}

export function PrivateRepoPrompt({
  teamSlugOrId,
  repo,
  githubOwner,
  githubAppSlug: githubAppSlugProp,
}: PrivateRepoPromptProps) {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInstallApp = useCallback(async () => {
    setIsRedirecting(true);
    setError(null);

    try {
      const currentUrl = window.location.href;
      try {
        sessionStorage.setItem("pr_review_return_url", currentUrl);
      } catch (storageError) {
        console.warn(
          "[PrivateRepoPrompt] Failed to persist return URL",
          storageError,
        );
      }

      const githubAppSlug =
        githubAppSlugProp || process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
      if (!githubAppSlug) {
        setError("GitHub App is not configured. Please contact support.");
        setIsRedirecting(false);
        return;
      }

      const response = await fetch("/api/integrations/github/install-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamSlugOrId,
          returnUrl: currentUrl,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 403) {
          setError(
            "You do not have permission to install the GitHub App for this team.",
          );
        } else if (response.status === 401) {
          setError("You need to sign in first. Redirecting...");
          setTimeout(() => {
            const returnTo = encodeURIComponent(window.location.pathname);
            window.location.href = `/sign-in?after_auth_return_to=${returnTo}`;
          }, 2_000);
        } else {
          setError(`Failed to start installation: ${text}`);
        }
        setIsRedirecting(false);
        return;
      }

      const { state } = (await response.json()) as { state: string };
      const installUrl = new URL(
        `https://github.com/apps/${githubAppSlug}/installations/new`,
      );
      installUrl.searchParams.set("state", state);

      window.location.href = installUrl.toString();
    } catch (err) {
      console.error("[PrivateRepoPrompt] Failed to initiate installation", err);
      setError("An unexpected error occurred. Please try again.");
      setIsRedirecting(false);
    }
  }, [githubAppSlugProp, teamSlugOrId]);

  return (
    <div className="min-h-dvh bg-gradient-to-br from-neutral-950 via-neutral-950 to-neutral-900 text-neutral-100 flex items-center justify-center px-6 py-12 sm:py-16">
      <div className="max-w-3xl w-full">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-6 sm:p-10 shadow-[0_20px_60px_-35px_rgba(0,0,0,0.9)] backdrop-blur">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
            <div className="shrink-0">
              <div className="h-14 w-14 rounded-full bg-amber-500/10 ring-1 ring-inset ring-amber-400/30 flex items-center justify-center">
                <AlertCircle className="h-7 w-7 text-amber-300" />
              </div>
            </div>
            <div className="flex-1 min-w-0 space-y-6">
              <h1 className="text-2xl sm:text-3xl font-semibold text-white">
                Private Repository Access Required
              </h1>
              <p className="text-base text-neutral-300 leading-relaxed">
                The repository
                <span className="mx-1 font-mono font-medium text-white">
                  {githubOwner}/{repo}
                </span>
                appears to be private or you do not have permission to view it.
              </p>

              <div className="space-y-4">
                <div className="rounded-xl bg-neutral-900/60 border border-neutral-800 p-5 sm:p-6">
                  <h2 className="text-sm font-semibold text-white mb-3 uppercase tracking-wide">
                    To continue, you need to:
                  </h2>
                  <ol className="space-y-3 text-sm sm:text-base text-neutral-300">
                    <li className="flex items-start gap-3">
                      <span className="shrink-0 font-semibold text-white">
                        1.
                      </span>
                      <span className="leading-relaxed">Install the cmux GitHub App</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="shrink-0 font-semibold text-white">
                        2.
                      </span>
                      <span className="leading-relaxed">Grant access to this repository</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="shrink-0 font-semibold text-white">
                        3.
                      </span>
                      <span className="leading-relaxed">
                        You will be redirected back automatically
                      </span>
                    </li>
                  </ol>
                </div>

                {error && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                    <p className="text-sm text-red-200">{error}</p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleInstallApp}
                  disabled={isRedirecting}
                  className="w-full inline-flex items-center justify-center gap-3 rounded-lg bg-amber-400/90 px-6 py-3 text-base font-medium text-neutral-950 transition-colors hover:bg-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:ring-offset-2 focus:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRedirecting ? (
                    <>
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-950 border-t-transparent" />
                      <span className="font-medium">Redirecting to GitHub…</span>
                    </>
                  ) : (
                    <>
                      <Github className="h-5 w-5 text-neutral-950" />
                      <span className="font-semibold">Install GitHub App</span>
                    </>
                  )}
                </button>

                <p className="text-xs text-center text-neutral-500">
                  You will be redirected to github.com to authorize the cmux app.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
