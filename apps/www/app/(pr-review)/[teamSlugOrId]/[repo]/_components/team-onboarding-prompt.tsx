"use client";

import { useState } from "react";
import { Users, ArrowRight } from "lucide-react";

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
      // Generate a unique slug
      const timestamp = Date.now();
      const slug = `team-${timestamp}`;

      // Create a default team for the user
      const response = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "My Team",
          slug: slug,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown error" }));
        setError(errorData.message || "Failed to create team");
        setIsCreating(false);
        return;
      }

      const data = await response.json();

      // Redirect to the PR review page with the new team slug
      const currentPath = window.location.pathname;
      const newPath = currentPath.replace(
        `/${githubOwner}`,
        `/${data.slug}`
      );
      window.location.href = newPath;
    } catch (err) {
      console.error("Failed to create team:", err);
      setError("An unexpected error occurred. Please try again.");
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900 flex items-center justify-center px-6">
      <div className="max-w-2xl w-full">
        <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <div className="h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center">
                <Users className="h-6 w-6 text-blue-600" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-semibold text-neutral-900">
                Welcome to cmux!
              </h1>
              <p className="mt-3 text-base text-neutral-600 leading-relaxed">
                To view pull requests, you need to create a team first. Teams help
                organize your repositories and collaborate with others.
              </p>

              <div className="mt-6 space-y-4">
                <div className="rounded-lg bg-neutral-50 p-4 border border-neutral-200">
                  <h2 className="text-sm font-semibold text-neutral-900 mb-2">
                    You&apos;re trying to access:
                  </h2>
                  <p className="text-sm text-neutral-600 font-mono">
                    {githubOwner}/{repo} - Pull Request #{pullNumber}
                  </p>
                </div>

                <div className="rounded-lg bg-blue-50 p-4 border border-blue-200">
                  <h2 className="text-sm font-semibold text-neutral-900 mb-2">
                    What happens next:
                  </h2>
                  <ol className="space-y-2 text-sm text-neutral-600">
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 font-semibold text-neutral-900">
                        1.
                      </span>
                      <span>We&apos;ll create a team for you</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 font-semibold text-neutral-900">
                        2.
                      </span>
                      <span>
                        You&apos;ll install the cmux-agent on your GitHub repositories
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 font-semibold text-neutral-900">
                        3.
                      </span>
                      <span>You&apos;ll be able to view and review pull requests</span>
                    </li>
                  </ol>
                </div>

                {error && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                )}

                <button
                  onClick={handleCreateTeam}
                  disabled={isCreating}
                  className="w-full inline-flex items-center justify-center gap-3 rounded-lg bg-neutral-900 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreating ? (
                    <>
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Creating your team...</span>
                    </>
                  ) : (
                    <>
                      <span>Get Started</span>
                      <ArrowRight className="h-5 w-5" />
                    </>
                  )}
                </button>

                <p className="text-xs text-center text-neutral-500">
                  You can rename your team and invite members later.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
