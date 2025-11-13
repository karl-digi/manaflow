import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Custom Vite plugin to resolve workspace packages and ensure they're bundled
export function resolveWorkspacePackages(): Plugin {
  return {
    name: "resolve-workspace-packages",
    enforce: "pre",
    resolveId(id, importer) {
      // Handle .js imports from TypeScript files in @cmux/server
      // This allows TypeScript to use .js extensions while resolving to .ts files
      if (importer && importer.includes("apps/server/src/")) {
        // For relative imports with .js extension from server files
        if (id.startsWith("./") && id.endsWith(".js")) {
          const tsPath = resolvePath(
            dirname(importer),
            id.replace(/\.js$/, ".ts")
          );
          return tsPath;
        }
      }

      // Also handle when electron builds import the server files
      // When importing @cmux/server files that reference .js extensions internally
      if (id.endsWith(".js") && id.includes("/apps/server/src/")) {
        const tsPath = id.replace(/\.js$/, ".ts");
        return tsPath;
      }
      if (id === "@cmux/convex/api") {
        return resolvePath(
          __dirname,
          "../../packages/convex/convex/_generated/api.js"
        );
      }

      if (id === "@cmux/server/realtime") {
        return resolvePath(__dirname, "../../apps/server/src/realtime.ts");
      }

      if (id === "@cmux/server/socket-handlers") {
        return resolvePath(
          __dirname,
          "../../apps/server/src/socket-handlers.ts"
        );
      }

      if (id === "@cmux/server/gitDiff") {
        return resolvePath(__dirname, "../../apps/server/src/gitDiff.ts");
      }

      if (id === "@cmux/server/server") {
        return resolvePath(__dirname, "../../apps/server/src/server.ts");
      }

      if (id === "@cmux/server") {
        return resolvePath(__dirname, "../../apps/server/src/index.ts");
      }

      if (id === "@cmux/shared" || id === "@cmux/shared/index") {
        return resolvePath(__dirname, "../../packages/shared/src/index.ts");
      }
      // Explicit subpath mappings for shared
      if (id === "@cmux/shared/socket") {
        return resolvePath(
          __dirname,
          "../../packages/shared/src/socket-client.ts"
        );
      }
      if (id === "@cmux/shared/node/socket") {
        return resolvePath(
          __dirname,
          "../../packages/shared/src/node/socket-server.ts"
        );
      }

      if (id === "@cmux/convex") {
        return resolvePath(
          __dirname,
          "../../packages/convex/convex/_generated/server.js"
        );
      }

      // Handle subpath imports for shared
      if (id.startsWith("@cmux/shared/")) {
        const subpath = id.slice("@cmux/shared/".length);
        return resolvePath(
          __dirname,
          `../../packages/shared/src/${subpath}.ts`
        );
      }

      return null;
    },
  };
}
