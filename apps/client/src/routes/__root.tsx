import { useTheme } from "@/components/theme/use-theme";
import type { Id } from "@cmux/convex/dataModel";
import type { StackClientApp } from "@stackframe/react";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  createRootRouteWithContext,
  Outlet,
  useRouter,
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
});

function ToasterWithTheme() {
  const { theme } = useTheme();
  return <Toaster richColors theme={theme} />;
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

      toast("New version available", {
        id: AUTO_UPDATE_TOAST_ID,
        duration: 30000,
        description: `Restart cmux to apply the latest version${versionLabel}.`,
        className: "select-none",
        action: cmux?.autoUpdate
          ? {
              label: "Restart now",
              onClick: () => {
                void cmux.autoUpdate
                  .install()
                  .then((result) => {
                    if (result && !result.ok) {
                      const reason =
                        result.reason === "not-packaged"
                          ? "Updates can only be applied from the packaged app."
                          : "Failed to restart. Try again from the menu.";
                      toast.error(reason);
                    }
                  })
                  .catch((error) => {
                    console.error(
                      "Failed to trigger auto-update install",
                      error
                    );
                    toast.error("Couldn't restart. Try again from the menu.");
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
  const router = useRouter();
  const location = useRouterState({
    select: (state) => state.location,
  });

  useAutoUpdateNotifications();

  useEffect(() => {
    const maybeWindow = typeof window === "undefined" ? undefined : window;
    const cmux = maybeWindow?.cmux;
    if (!cmux?.on) return;

    const handler = (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const record = payload as Record<string, unknown>;
      const teamSlugOrId =
        typeof record.teamSlugOrId === "string"
          ? record.teamSlugOrId.trim()
          : "";
      const taskId =
        typeof record.taskId === "string" ? record.taskId.trim() : "";
      const runId =
        typeof record.runId === "string" ? record.runId.trim() : "";
      if (!teamSlugOrId || !taskId || !runId) {
        return;
      }

      router.navigate({
        to: "/$teamSlugOrId/task/$taskId/run/$runId/diff",
        params: {
          teamSlugOrId,
          taskId: taskId as Id<"tasks">,
          runId: runId as Id<"taskRuns">,
        },
      });
    };

    const unsubscribe = cmux.on("task-diff:navigate", handler);

    return () => {
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, [router]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log("[navigation] location-changed", {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        timestamp: new Date().toISOString(),
      });
    }
  }, [location]);

  return (
    <>
      <Outlet />
      <DevTools />
      <ToasterWithTheme />
    </>
  );
}
