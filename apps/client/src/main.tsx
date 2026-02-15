import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";
import { SENTRY_WEB_DSN } from "./sentry-config";

// Defer Sentry initialization to after first paint for faster LCP
// Use requestIdleCallback to load during browser idle time
if (SENTRY_WEB_DSN) {
  const initSentry = () => {
    import("@sentry/react").then(
      ({ init, tanstackRouterBrowserTracingIntegration }) => {
        import("./router").then(({ router }) => {
          init({
            dsn: SENTRY_WEB_DSN,
            integrations: [tanstackRouterBrowserTracingIntegration(router)],
            tracesSampleRate: 0.1, // Reduced from 1.0 for production
          });
        });
      }
    );
  };

  if ("requestIdleCallback" in window) {
    requestIdleCallback(initSentry);
  } else {
    // Fallback for browsers without requestIdleCallback (Safari)
    setTimeout(initSentry, 1);
  }
}

const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
