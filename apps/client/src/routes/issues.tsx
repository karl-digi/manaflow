import { convexAuthReadyPromise } from "@/contexts/convex/convex-auth-ready";
import { ConvexClientProvider } from "@/contexts/convex/convex-client-provider";
import { cachedGetUser } from "@/lib/cachedGetUser";
import { stackClientApp } from "@/lib/stack";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_issues")({
  component: IssuesLayout,
  beforeLoad: async () => {
    const user = await cachedGetUser(stackClientApp);
    if (!user) {
      throw redirect({
        to: "/sign-in",
        search: {
          after_auth_return_to: location.pathname,
        },
      });
    }
    const convexAuthReady = await convexAuthReadyPromise;
    if (!convexAuthReady) {
      console.log("[IssuesRoute.beforeLoad] convexAuthReady:", convexAuthReady);
    }
  },
});

function IssuesLayout() {
  return (
    <ConvexClientProvider>
      <div className="min-h-screen bg-background">
        <Outlet />
      </div>
    </ConvexClientProvider>
  );
}
