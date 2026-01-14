import { isElectron } from "@/lib/electron";
import { createHashHistory, createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { queryClient } from "./query-client";
import { routeTree } from "./routeTree.gen";
import { DefaultPendingComponent } from "./components/DefaultPendingComponent";

function createRouter() {
  const router = routerWithQueryClient(
    createTanStackRouter({
      routeTree,
      defaultPreload: "intent",
      context: {
        queryClient: undefined!,
        auth: undefined!,
      },
      scrollRestoration: true,
      // When running under Electron, use hash-based history so
      // file:// URLs don't break route matching in production builds.
      history: isElectron ? createHashHistory() : undefined,
      // Show loading state during route transitions (e.g., while beforeLoad polls
      // for team membership to handle webhook sync lag for new users)
      defaultPendingComponent: DefaultPendingComponent,
      defaultPendingMinMs: 250, // Minimum time to show the pending component (matches BootLoader)
    }),
    queryClient
  );

  return router;
}

export const router = createRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
