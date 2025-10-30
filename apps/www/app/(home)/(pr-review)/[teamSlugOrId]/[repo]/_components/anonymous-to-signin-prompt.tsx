"use client";

import { useEffect } from "react";
import { useStackApp } from "@stackframe/stack";
import { LogIn } from "lucide-react";

interface AnonymousToSignInPromptProps {
  returnUrl: string;
}

/**
 * Prompt shown to anonymous users trying to access a private repository.
 * Redirects them to sign in with a real account.
 */
export function AnonymousToSignInPrompt({
  returnUrl,
}: AnonymousToSignInPromptProps) {
  const app = useStackApp();

  useEffect(() => {
    // Automatically redirect to sign-in after a brief moment
    const timer = setTimeout(() => {
      const returnTo = encodeURIComponent(returnUrl);
      const signInUrl = `${app.urls.signIn}?after_auth_return_to=${returnTo}`;
      window.location.href = signInUrl;
    }, 1500);

    return () => clearTimeout(timer);
  }, [app.urls.signIn, returnUrl]);

  return (
    <div className="min-h-dvh bg-gradient-to-br from-neutral-950 via-neutral-950 to-neutral-900 text-neutral-100 flex items-center justify-center px-6 py-12 sm:py-16">
      <div className="max-w-3xl w-full">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-6 sm:p-10 shadow-[0_20px_60px_-35px_rgba(0,0,0,0.9)] backdrop-blur">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
            <div className="shrink-0">
              <div className="h-14 w-14 rounded-full bg-indigo-500/10 ring-1 ring-inset ring-indigo-400/30 flex items-center justify-center">
                <LogIn className="h-7 w-7 text-indigo-300" />
              </div>
            </div>
            <div className="flex-1 min-w-0 space-y-6">
              <h1 className="text-2xl sm:text-3xl font-semibold text-white">
                Sign In Required
              </h1>
              <p className="text-base text-neutral-300 leading-relaxed">
                This is a private repository. Please sign in with your account to
                continue.
              </p>

              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm text-neutral-400">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-300 border-t-transparent" />
                  <span>Redirecting to sign in...</span>
                </div>
                <p className="text-xs text-neutral-500">
                  If nothing happens, refresh the page to try again.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
