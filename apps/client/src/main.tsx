import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";

import "./antd-overrides.css";
import "./zindex.css";
import "./index.css";

// Global error logging to help diagnose loader stalls
// Logs both synchronous render errors and async unhandled rejections.
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    const err = event.error ?? event.message ?? "Unknown window error";
    console.error("[GlobalError]", err);
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[UnhandledRejection]", event.reason ?? "Unknown rejection");
  });
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
