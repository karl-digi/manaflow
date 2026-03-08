import { useTheme } from "@/components/theme/use-theme";
import type { StackClientApp } from "@stackframe/react";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  createRootRouteWithContext,
  type ErrorComponentProps,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { useEffect, useState } from "react";
import { toast, Toaster } from "sonner";

const AUTO_UPDATE_TOAST_ID = "auto-update-toast";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  auth: StackClientApp<true, string>;
}>()({
  component: RootComponent,
  errorComponent: RootErrorComponent,
});

function ToasterWithTheme() {
  const { theme } = useTheme();
  return <Toaster richColors theme={theme} />;
}

/**
 * Checks if an error indicates a definitive session expiry that requires sign-in.
 * Only matches errors that clearly indicate the user needs to re-authenticate,
 * not transient network errors or API errors that happen to contain "Unauthorized".
 *
 * This is intentionally conservative to avoid redirect loops when:
 * - Token refresh is in progress
 * - Network temporarily fails
 * - A single API call returns 401 but auth is still valid
 */
function isAuthError(error: unknown): boolean {
  if (!error) return false;

  const errorObj = error as Record<string, unknown>;
  const message =
    typeof errorObj.message === "string"
      ? errorObj.message.toLowerCase()
      : error instanceof Error
        ? error.message.toLowerCase()
        : "";

  // Only redirect for "User not found" - this is thrown by fetchWithAuth
  // when Stack Auth cannot get a user, meaning the session is definitely gone
  if (message === "user not found") {
    return true;
  }

  // For 401 errors, only redirect if they have specific token expiry indicators
  // that our retry logic couldn't recover from
  const is401 = errorObj.status === 401 || errorObj.statusCode === 401;
  if (is401) {
    const hasTokenExpiry =
      message.includes("token expired") ||
      message.includes("jwt expired") ||
      message.includes("invalid auth header expired") ||
      message.includes("token has expired");
    return hasTokenExpiry;
  }

  return false;
}

/**
 * Clears the cached user globals to force a fresh fetch after redirect.
 */
function clearCachedUser(): void {
  if (typeof window !== "undefined") {
    window.cachedUser = null;
    window.userPromise = null;
  }
}

function RootErrorComponent({ error, reset }: ErrorComponentProps) {
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const [isRedirecting, setIsRedirecting] = useState(false);

  const isAuth = isAuthError(error);
  const isAuthRoute =
    location.pathname === "/sign-in" ||
    location.pathname.startsWith("/handler/");

  useEffect(() => {
    // Redirect to sign-in for auth errors, unless already on auth routes
    if (isAuth && !isAuthRoute && !isRedirecting) {
      setIsRedirecting(true);
      clearCachedUser();

      const returnTo = `${location.pathname}${location.search ? `?${new URLSearchParams(location.search as Record<string, string>).toString()}` : ""}`;
      navigate({
        to: "/sign-in",
        search: { after_auth_return_to: returnTo },
        replace: true,
      });
    }
  }, [isAuth, isAuthRoute, isRedirecting, location, navigate]);

  // Show minimal UI while redirecting
  if (isAuth && !isAuthRoute) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <div className="text-center">
          <p className="text-neutral-600 dark:text-neutral-400">
            Session expired, redirecting to sign in...
          </p>
        </div>
      </div>
    );
  }

  // For non-auth errors, show generic error UI
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <div className="max-w-md p-6 text-center">
        <h1 className="mb-4 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Something went wrong
        </h1>
        <p className="mb-6 text-neutral-600 dark:text-neutral-400">
          An unexpected error occurred. Please try again.
        </p>
        {import.meta.env.DEV && error && (
          <pre className="mb-6 max-h-48 overflow-auto rounded bg-neutral-100 p-4 text-left text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
            {error instanceof Error
              ? `${error.name}: ${error.message}\n${error.stack || ""}`
              : String(error)}
          </pre>
        )}
        <button
          onClick={reset}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function DevTools() {
  const [devToolsOpen, setDevToolsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === "i") {
        setDevToolsOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (!devToolsOpen) {
    return null;
  }

  return (
    <>
      <TanStackRouterDevtools position="bottom-right" />
      <ReactQueryDevtools />
    </>
  );
}

function useAutoUpdateNotifications() {
  useEffect(() => {
    const maybeWindow = typeof window === "undefined" ? undefined : window;
    const cmux = maybeWindow?.cmux;

    const showToast = (version: string | null) => {
      const versionLabel = version ? ` (${version})` : "";

      const showRestartingToast = () => {
        toast.loading("Restarting Manaflow...", {
          id: AUTO_UPDATE_TOAST_ID,
          duration: Infinity,
          description: "Please wait while the update is being applied.",
          className: "select-none",
        });
      };

      toast("New version available", {
        id: AUTO_UPDATE_TOAST_ID,
        duration: 30000,
        description: `Restart Manaflow to apply the latest version${versionLabel}.`,
        className: "select-none",
        action: cmux?.autoUpdate
          ? {
              label: "Restart now",
              onClick: () => {
                showRestartingToast();
                void cmux.autoUpdate
                  .install()
                  .then((result) => {
                    if (result && !result.ok) {
                      const reason =
                        result.reason === "not-packaged"
                          ? "Updates can only be applied from the packaged app."
                          : "Failed to restart. Try again from the menu.";
                      toast.error(reason, { id: AUTO_UPDATE_TOAST_ID });
                    }
                  })
                  .catch((error) => {
                    console.error(
                      "Failed to trigger auto-update install",
                      error
                    );
                    toast.error("Couldn't restart. Try again from the menu.", {
                      id: AUTO_UPDATE_TOAST_ID,
                    });
                  });
              },
            }
          : undefined,
      });
    };

    if (!cmux?.on) return;

    const handler = (payload: unknown) => {
      const version =
        payload && typeof payload === "object" && "version" in payload
          ? typeof (payload as { version?: unknown }).version === "string"
            ? (payload as { version: string }).version
            : null
          : null;

      showToast(version);
    };

    const unsubscribe = cmux.on("auto-update:ready", handler);

    return () => {
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, []);
}

function RootComponent() {
  const location = useRouterState({
    select: (state) => state.location,
  });
  const locationKey = `${location.pathname}${JSON.stringify(location.search)}${location.hash}`;

  useAutoUpdateNotifications();

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log("[navigation] location-changed", {
        location: locationKey,
        timestamp: new Date().toISOString(),
      });
    }
  }, [locationKey]);

  return (
    <>
      <Outlet />
      <DevTools />
      <ToasterWithTheme />
    </>
  );
}
