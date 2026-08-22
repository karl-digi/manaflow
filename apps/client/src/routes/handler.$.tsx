import { stackClientApp } from "@/lib/stack";
import { liftOAuthQueryToWindowSearch } from "@/lib/stack-handler-location";
import { StackHandler } from "@stackframe/react";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useLayoutEffect } from "react";

export const Route = createFileRoute("/handler/$")({
  component: HandlerComponent,
});

function HandlerComponent() {
  const location = useLocation();
  // StackHandler matches pathname only; callOAuthCallback reads window.location.search.
  useLayoutEffect(() => {
    liftOAuthQueryToWindowSearch(location.searchStr);
  }, [location.searchStr]);

  return (
    <StackHandler app={stackClientApp} location={location.pathname} fullPage />
  );
}
