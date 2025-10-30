"use client";

import { useState } from "react";
import { ArrowRight, Users } from "lucide-react";

interface TeamOnboardingPromptProps {
  githubOwner: string;
  repo: string;
  pullNumber: number;
}

export function TeamOnboardingPrompt({
  githubOwner,
  repo,
  pullNumber,
}: TeamOnboardingPromptProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateTeam = async () => {
    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "My Team",
          slug: `team-${Date.now()}`,
        }),
      });

      if (!response.ok) {
        const data = await response
          .json()
          .catch(() => ({ message: "Unknown error" }));
        setError(data.message ?? "Failed to create team");
        setIsCreating(false);
        return;
      }

      const team = await response.json();
      const currentPath = window.location.pathname;
      const nextPath = currentPath.replace(
        `/${encodeURIComponent(githubOwner)}`,
        `/${encodeURIComponent(team.slug)}`,
      );
      window.location.href = nextPath;
    } catch (creationError) {
      console.error("[TeamOnboardingPrompt] Failed to create team", creationError);
      setError("Something went wrong. Please try again.");
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gradient-to-br from-neutral-950 via-neutral-950 to-neutral-900 text-neutral-100 flex items-center justify-center px-6 py-12 sm:py-16">
      <div className="max-w-3xl w-full">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-6 sm:p-10 shadow-[0_20px_60px_-35px_rgba(0,0,0,0.9)] backdrop-blur">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
            <div className="shrink-0">
              <div className="h-14 w-14 rounded-full bg-blue-500/10 ring-1 ring-inset ring-blue-400/30 flex items-center justify-center">
                <Users className="h-7 w-7 text-blue-300" />
              </div>
            </div>
            <div className="flex-1 min-w-0 space-y-6">
              <h1 className="text-2xl sm:text-3xl font-semibold text-white">
                Welcome to cmux!
              </h1>
              <p className="text-base text-neutral-300 leading-relaxed">
                To view pull requests you need a team. Teams help organize
                repositories and share access with collaborators.
              </p>

              <div className="space-y-4">
                <div className="rounded-xl bg-neutral-900/60 border border-neutral-800 p-5 sm:p-6">
                  <h2 className="text-sm font-semibold text-white mb-3 uppercase tracking-wide">
                    You&apos;re trying to access:
                  </h2>
                  <p className="text-sm sm:text-base text-neutral-300 font-mono">
                    {githubOwner}/{repo} · PR #{pullNumber}
                  </p>
                </div>

                <div className="rounded-xl bg-blue-500/10 border border-blue-400/30 p-5 sm:p-6">
                  <h2 className="text-sm font-semibold text-white mb-3 uppercase tracking-wide">
                    What happens next:
                  </h2>
                  <ol className="space-y-3 text-sm sm:text-base text-neutral-300">
                    <li className="flex items-start gap-3">
                      <span className="shrink-0 font-semibold text-white">
                        1.
                      </span>
                      <span className="leading-relaxed">We’ll create a starter team for you</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="shrink-0 font-semibold text-white">
                        2.
                      </span>
                      <span className="leading-relaxed">
                        You can install the cmux GitHub App for your repos
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="shrink-0 font-semibold text-white">
                        3.
                      </span>
                      <span className="leading-relaxed">Return here to review your pull request</span>
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
                  onClick={handleCreateTeam}
                  disabled={isCreating}
                  className="w-full inline-flex items-center justify-center gap-3 rounded-lg bg-blue-400/90 px-6 py-3 text-base font-semibold text-neutral-950 transition-colors hover:bg-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:ring-offset-2 focus:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreating ? (
                    <>
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-950 border-t-transparent" />
                      <span className="font-medium">Creating your team…</span>
                    </>
                  ) : (
                    <>
                      <span>Create a team</span>
                      <ArrowRight className="h-5 w-5 text-neutral-950" />
                    </>
                  )}
                </button>

                <p className="text-xs text-center text-neutral-500">
                  You can rename your team and invite others later.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
