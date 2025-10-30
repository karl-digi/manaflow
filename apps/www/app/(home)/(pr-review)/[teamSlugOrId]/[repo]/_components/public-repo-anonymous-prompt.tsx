"use client";

import { useCallback, useState } from "react";
import { Eye, LogIn } from "lucide-react";
import { useStackApp } from "@stackframe/stack";
import { useRouter } from "next/navigation";

interface PublicRepoAnonymousPromptProps {
  teamSlugOrId: string;
  repo: string;
  githubOwner: string;
  pullNumber: number;
}

/**
 * Prompt shown to anonymous users viewing a public repository.
 * Allows them to sign in to access the PR review features.
 */
export function PublicRepoAnonymousPrompt({
  teamSlugOrId: _teamSlugOrId,
  repo,
  githubOwner,
  pullNumber,
}: PublicRepoAnonymousPromptProps) {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const app = useStackApp();
  const router = useRouter();

  const handleAnonymousSignIn = useCallback(async () => {
    setIsSigningIn(true);
    setError(null);

    try {
      // Call our server-side API to create anonymous user
      const response = await fetch("/api/auth/anonymous/sign-up", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      const data = await response.json();
      console.log("[PublicRepoAnonymousPrompt] API Response:", data);

      if (!response.ok || !data.success) {
        console.error("[PublicRepoAnonymousPrompt] Anonymous sign-up failed:", data);
        setError(data.message || "Failed to create anonymous session");
        setIsSigningIn(false);
        return;
      }

      const currentUrl = new URL(window.location.href);
      let targetPath = currentUrl.pathname;
      if (targetPath.endsWith("/auth")) {
        targetPath = targetPath.slice(0, -"/auth".length) || "/";
      }
      const targetUrl = `${targetPath}${currentUrl.search}${currentUrl.hash}`;

      router.push(targetUrl);
    } catch (err) {
      console.error(
        "[PublicRepoAnonymousPrompt] Failed to create anonymous user",
        err
      );
      setError("An unexpected error occurred. Please try again.");
      setIsSigningIn(false);
    }
  }, [router]);

  const handleRegularSignIn = useCallback(async () => {
    setIsSigningIn(true);
    setError(null);

    try {
      // Use Stack Auth sign-in URL with return path
      const returnTo = encodeURIComponent(window.location.pathname);
      const signInUrl = `${app.urls.signIn}?after_auth_return_to=${returnTo}`;
      window.location.href = signInUrl;
    } catch (err) {
      console.error(
        "[PublicRepoAnonymousPrompt] Failed to initiate sign-in",
        err
      );
      setError("An unexpected error occurred. Please try again.");
      setIsSigningIn(false);
    }
  }, [app.urls.signIn]);

  return (
    <div className="min-h-dvh bg-gradient-to-br from-neutral-950 via-neutral-950 to-neutral-900 text-neutral-100 flex items-center justify-center px-6 py-12 sm:py-16">
      <div className="max-w-3xl w-full">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-6 sm:p-10 shadow-[0_20px_60px_-35px_rgba(0,0,0,0.9)] backdrop-blur">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
            <div className="shrink-0">
              <div className="h-14 w-14 rounded-full bg-indigo-500/10 ring-1 ring-inset ring-indigo-400/30 flex items-center justify-center">
                <Eye className="h-7 w-7 text-indigo-300" />
              </div>
            </div>
            <div className="flex-1 min-w-0 space-y-6">
              <h1 className="text-2xl sm:text-3xl font-semibold text-white">
                Public Repository Access
              </h1>
              <p className="text-base text-neutral-300 leading-relaxed">
                You&apos;re viewing a public repository
                <span className="mx-1 font-mono font-medium text-white">
                  {githubOwner}/{repo}
                </span>
                (PR #{pullNumber}). Sign in to access code review features.
              </p>

              <div className="space-y-4">
                <div className="rounded-xl bg-neutral-900/60 border border-neutral-800 p-5 sm:p-6">
                  <h2 className="text-sm font-semibold text-white mb-3 uppercase tracking-wide">
                    What you can do:
                  </h2>
                  <ul className="space-y-3 text-sm sm:text-base text-neutral-300">
                    <li className="flex items-start gap-3">
                      <span className="shrink-0 text-indigo-300">•</span>
                      <span className="leading-relaxed">
                        View pull request changes and diffs
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="shrink-0 text-indigo-300">•</span>
                      <span className="leading-relaxed">Browse code review insights</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="shrink-0 text-indigo-300">•</span>
                      <span className="leading-relaxed">Access all public repository features</span>
                    </li>
                  </ul>
                </div>

                {error && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                    <p className="text-sm text-red-200">{error}</p>
                  </div>
                )}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <button
                    type="button"
                    onClick={handleAnonymousSignIn}
                    disabled={isSigningIn}
                    className="w-full inline-flex items-center justify-center gap-3 rounded-lg bg-indigo-400/90 px-6 py-3 text-base font-semibold text-neutral-950 transition-colors hover:bg-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:ring-offset-2 focus:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSigningIn ? (
                      <>
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-950 border-t-transparent" />
                        <span className="font-medium">Creating anonymous session…</span>
                      </>
                    ) : (
                      <>
                        <Eye className="h-5 w-5 text-neutral-950" />
                        <span>Continue as Guest</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleRegularSignIn}
                    disabled={isSigningIn}
                    className="w-full inline-flex items-center justify-center gap-3 rounded-lg border border-neutral-700/80 bg-neutral-900/60 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-600 focus:ring-offset-2 focus:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <LogIn className="h-5 w-5" />
                    <span>Sign In</span>
                  </button>
                </div>

                <p className="text-xs text-center text-neutral-500">
                  Sign in to access code review features for public repositories.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
