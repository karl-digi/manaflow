import { isElectron } from "@/lib/electron";
import { createHashHistory, createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { queryClient } from "./query-client";
import { routeTree } from "./routeTree.gen";

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
      // Packaged Electron uses hash history; electron-vite dev uses browser history.
      history:
        isElectron && import.meta.env.PROD ? createHashHistory() : undefined,
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
