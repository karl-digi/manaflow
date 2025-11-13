import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Load root .env so tests have Stack and GitHub env values
// In ESM, __dirname is not defined; derive it from import.meta.url
const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export default defineConfig({
  // Avoid Vite plugin type mismatches by setting alias directly
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
  },
  envPrefix: "NEXT_PUBLIC_",
});
