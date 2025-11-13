import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin, PluginOption } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolveWorkspacePackages } from "./electron-vite-plugin-resolve-workspace";

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

export default defineConfig({
  main: {
    plugins: [
      createExternalizeDepsPlugin({
        exclude: [
          "@cmux/server",
          "@cmux/server/**",
          "@cmux/shared",
          "@cmux/convex",
          "@cmux/www-openapi-client",
        ],
      }),
      resolveWorkspacePackages(),
    ],
    envDir: repoRoot,
    build: {
      rollupOptions: {
        input: {
          index: resolve("electron/main/bootstrap.ts"),
        },
        treeshake: "smallest",
      },
    },
    envPrefix: "NEXT_PUBLIC_",
  },
  preload: {
    plugins: [
      createExternalizeDepsPlugin({
        exclude: ["@cmux/server", "@cmux/server/**"],
      }),
      resolveWorkspacePackages(),
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
        treeshake: "smallest",
      },
    },
    envPrefix: "NEXT_PUBLIC_",
  },
  renderer: {
    root: ".",
    envDir: repoRoot,
    base: "./",
    build: {
      rollupOptions: {
        input: {
          index: resolve("index.html"),
        },
        treeshake: "recommended",
      },
    },
    resolve: {
      alias: {
        "@": resolve("src"),
      },
      // Dedupe so Monaco services (e.g. hoverService) are registered once
      dedupe: ["monaco-editor"],
    },
    optimizeDeps: {
      // Skip pre-bundling to avoid shipping a second Monaco runtime copy
      exclude: ["monaco-editor"],
    },
    plugins: [
      tsconfigPaths(),
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
    ],
    envPrefix: "NEXT_PUBLIC_",
  },
});
