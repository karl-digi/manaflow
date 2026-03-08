"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocation, useMatch, useNavigate } from "@tanstack/react-router";
import { ConvexProvider } from "convex/react";
import { type ReactNode, useEffect } from "react";
import { authJsonQueryOptions } from "./authJsonQueryOptions";
import { convexAuthReadyPromise } from "./convex-auth-ready";
import { convexQueryClient } from "./convex-query-client";
import clsx from "clsx";

// Lightweight skeleton that shows immediately - no artificial delays
function LoadingSkeleton() {
  return (
    <div className="absolute inset-0 w-screen h-dvh flex flex-col bg-white dark:bg-black z-[var(--z-global-blocking)]">
      <div className="h-12 border-b border-neutral-200 dark:border-neutral-800" />
      <div className="flex-1 flex flex-col items-center pt-32 px-4">
        <div className="w-full max-w-4xl space-y-4 animate-pulse">
          <div className="h-32 bg-neutral-100 dark:bg-neutral-900 rounded-2xl" />
          <div className="h-8 bg-neutral-100 dark:bg-neutral-900 rounded w-1/3" />
          <div className="space-y-2">
            <div className="h-16 bg-neutral-100 dark:bg-neutral-900 rounded-xl" />
            <div className="h-16 bg-neutral-100 dark:bg-neutral-900 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

function BootLoader({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const convexAuthReadyQuery = useQuery({
    queryKey: ["convexAuthReadyPromise"],
    queryFn: () => convexAuthReadyPromise,
  });
  const authJsonQuery = useQuery(authJsonQueryOptions());
  const teamRouteMatch = useMatch({
    from: "/_layout/$teamSlugOrId",
    shouldThrow: false,
  });
  const needsTeamAuth = Boolean(teamRouteMatch?.params.teamSlugOrId);
  const hasAuthToken = Boolean(authJsonQuery.data?.accessToken);
  const authQuerySettled = !authJsonQuery.isPending;
  const authFailed = authQuerySettled && needsTeamAuth && !hasAuthToken;

  // Redirect to sign-in if auth is required but failed/missing after query settled
  useEffect(() => {
    if (authFailed) {
      void navigate({
        to: "/sign-in",
        search: {
          after_auth_return_to: `${location.pathname}${location.searchStr}`,
        },
      });
    }
  }, [authFailed, location.pathname, location.searchStr, navigate]);

  const isConvexReady = Boolean(convexAuthReadyQuery.data);
  // Removed 250ms artificial delay - show content immediately when ready
  const isReady = isConvexReady && (!needsTeamAuth || hasAuthToken);
  return (
    <>
      <div
        className={clsx(
          "transition-opacity duration-150",
          isReady ? "opacity-0 pointer-events-none hidden" : "opacity-100",
        )}
      >
        <LoadingSkeleton />
      </div>
      {isReady ? children : null}
    </>
  );
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <>
      <BootLoader>
        <ConvexProvider client={convexQueryClient.convexClient}>
          {children}
        </ConvexProvider>
      </BootLoader>
    </>
  );
}
