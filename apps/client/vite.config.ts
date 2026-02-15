import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { createLogger, defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

import { relatedProjects } from "@vercel/related-projects";

const NEXT_PUBLIC_RELATED_WWW_ORIGIN_PREVIEW = relatedProjects({
  noThrow: true,
}).find((p) => p.project.name === "cmux-www")?.preview.branch;

// Ensure all env is loaded
await import("./src/client-env.ts");

const SentryVitePlugin = process.env.SENTRY_AUTH_TOKEN
  ? sentryVitePlugin({
      org: "manaflow",
      project: "cmux-client-web",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        filesToDeleteAfterUpload: ["**/*.map"],
      },
      telemetry: false,
    })
  : undefined;

// Suppress missing source map warnings for monaco-editor vendored libs (marked, dompurify)
const logger = createLogger();
const originalWarn = logger.warn;
logger.warn = (msg, options) => {
  if (
    msg.includes("Failed to load source map") &&
    msg.includes("node_modules/monaco-editor")
  ) {
    return;
  }
  originalWarn(msg, options);
};

// https://vite.dev/config/
export default defineConfig({
  customLogger: logger,
  plugins: [
    tsconfigPaths({
      // Only scan from apps/client to avoid walking synced dev-docs documentation files
      root: import.meta.dirname,
    }),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    SentryVitePlugin,
  ],
  resolve: {
    // Dedupe so Monaco services (e.g. hoverService) are registered once
    // Also dedupe react/react-dom required after @vitejs/plugin-react 5.x upgrade
    dedupe: ["monaco-editor", "react", "react-dom"],
    alias: {
      // Explicitly resolve workspace package subpath exports for rolldown-vite compatibility
      "@cmux/www-openapi-client/client.gen": path.resolve(
        import.meta.dirname,
        "../../packages/www-openapi-client/src/client/client.gen.ts"
      ),
    },
  },
  optimizeDeps: {
    // Skip pre-bundling to avoid shipping a second Monaco runtime copy
    exclude: ["monaco-editor"],
  },
  define: {
    "process.env": {},
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV || "development"
    ),
    "process.env.NEXT_PUBLIC_RELATED_WWW_ORIGIN_PREVIEW": JSON.stringify(
      NEXT_PUBLIC_RELATED_WWW_ORIGIN_PREVIEW
    ),
    global: "globalThis",
  },
  envPrefix: "NEXT_PUBLIC_",
  // TODO: make this safe
  server: {
    allowedHosts: true,
  },
});
