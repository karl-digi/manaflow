import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin, PluginOption } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolveWorkspacePackages } from "./electron-vite-plugin-resolve-workspace";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import MagicString from "magic-string";

// Plugin to inject __dirname/__filename shims for ESM compatibility with rolldown-vite
function esmDirnameShimPlugin(): Plugin {
  const shimCode = `import { fileURLToPath as ___fileURLToPath___ } from "node:url";
import { dirname as ___pathDirname___ } from "node:path";
const __filename = ___fileURLToPath___(import.meta.url);
const __dirname = ___pathDirname___(__filename);
`;
  return {
    name: "esm-dirname-shim",
    renderChunk(code) {
      // Only inject if code contains __dirname or __filename
      if (code.includes("__dirname") || code.includes("__filename")) {
        const s = new MagicString(code);
        s.prepend(shimCode);
        return { code: s.toString(), map: s.generateMap({ hires: true }) };
      }
      return null;
    },
  };
}

function createExternalizeDepsPlugin(
  options?: Parameters<typeof externalizeDepsPlugin>[0]
): PluginOption {
  const plugin = externalizeDepsPlugin(options);
  if (typeof plugin === "object" && plugin !== null && !Array.isArray(plugin)) {
    const typedPlugin = plugin as Plugin & { exclude?: string[] };
    typedPlugin.name = "externalize-deps";
    const excludeOption = options?.exclude ?? [];
    const normalizedExclude = Array.isArray(excludeOption)
      ? excludeOption
      : [excludeOption];
    typedPlugin.exclude = normalizedExclude.filter(
      (entry): entry is string => typeof entry === "string"
    );
  }
  return plugin;
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

const SentryVitePlugin = process.env.SENTRY_AUTH_TOKEN ? sentryVitePlugin({
  org: "manaflow",
  project: "cmux-client-electron",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    filesToDeleteAfterUpload: ["**/*.map"],
  },
  telemetry: false
}) : undefined;

// Determine if this is a production build based on command-line args
// electron-vite build = production, electron-vite dev = development
const isProduction = process.argv.includes("build");

export default defineConfig({
  main: {
    plugins: [
      createExternalizeDepsPlugin({
        include: ["electron"],
        exclude: [
          "@cmux/server",
          "@cmux/server/**",
          "@cmux/shared",
          "@cmux/convex",
          "@cmux/www-openapi-client",
          "@sentry/electron",
          "dockerode",
        ],
      }),
      resolveWorkspacePackages(),
      esmDirnameShimPlugin(),
      SentryVitePlugin,
    ],
    envDir: repoRoot,
    build: {
      rollupOptions: {
        input: {
          index: resolve("electron/main/bootstrap.ts"),
        },
        external: ["electron"],
        treeshake: "recommended",
      },
      sourcemap: true,
    },
    envPrefix: "NEXT_PUBLIC_",
  },
  preload: {
    plugins: [
      createExternalizeDepsPlugin({
        include: ["electron"],
        exclude: ["@cmux/server", "@cmux/server/**", "@sentry/electron"],
      }),
      resolveWorkspacePackages(),
      SentryVitePlugin,
    ],
    envDir: repoRoot,
    build: {
      rollupOptions: {
        input: {
          index: resolve("electron/preload/index.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
        external: ["electron"],
        treeshake: "smallest",
      },
      sourcemap: true,
    },
    envPrefix: "NEXT_PUBLIC_",
  },
  renderer: {
    root: ".",
    envDir: repoRoot,
    base: "/",
    define: {
      "process.env": {},
      "process.env.NODE_ENV": JSON.stringify(
        isProduction ? "production" : "development"
      ),
      global: "globalThis",
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve("index-electron.html"),
        },
        treeshake: "recommended",
      },
      sourcemap: true,
    },
    resolve: {
      alias: {
        "@": resolve("src"),
        "@cmux/www-openapi-client/client.gen": resolve(
          repoRoot,
          "packages/www-openapi-client/src/client/client.gen.ts"
        ),
      },
      // Dedupe so Monaco services (e.g. hoverService) are registered once
      // Also dedupe react/react-dom required after @vitejs/plugin-react-swc
      dedupe: ["monaco-editor", "react", "react-dom"],
    },
    optimizeDeps: {
      // Skip pre-bundling to avoid shipping a second Monaco runtime copy
      exclude: ["monaco-editor"],
    },
    plugins: [
      tsconfigPaths({
        // Skip synced documentation snapshots that are not part of the app workspace.
        skip: (dir) => dir.includes("dev-docs"),
      }),
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
      SentryVitePlugin,
    ],
    envPrefix: "NEXT_PUBLIC_",
  },
});
