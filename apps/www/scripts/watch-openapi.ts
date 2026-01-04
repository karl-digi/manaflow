import { app } from "@/lib/hono-app";
import { createClient } from "@hey-api/openapi-ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const quiet = !!process.env.CLAUDECODE;
const log = quiet ? () => {} : console.log.bind(console);

const startTime = performance.now();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fetchStart = performance.now();
const doc = await app.request("/api/doc", {
  method: "GET",
});
log(`[${(performance.now() - fetchStart).toFixed(2)}ms] fetch /api/doc`);

const outputPath = path.join(
  __dirname,
  "../../../packages/www-openapi-client/src/client"
);
const tsConfigPath = path.join(
  __dirname,
  "../../../packages/www-openapi-client/tsconfig.json"
);

// write to tmp file (unique name to avoid concurrent collisions)
const tmpFile = path.join(
  os.tmpdir(),
  `openapi-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
);
fs.writeFileSync(tmpFile, await doc.text());

const genStart = performance.now();
await createClient({
  input: tmpFile,
  output: {
    path: outputPath,
    tsConfigPath,
  },
  plugins: [
    "@hey-api/client-fetch",
    "@hey-api/typescript",
    "@tanstack/react-query",
  ],
  logs: quiet ? { level: "silent" } : undefined,
});
log(`[${(performance.now() - genStart).toFixed(2)}ms] generate client`);

try {
  fs.unlinkSync(tmpFile);
} catch {
  // ignore if already removed by concurrent runs
}

log(`[${(performance.now() - startTime).toFixed(2)}ms] watch-openapi complete`);
console.log("[watch-openapi] initial client generation complete");

const isWatchMode =
  process.execArgv.includes("--watch") ||
  process.env.OPENAPI_WATCH === "1" ||
  process.env.OPENAPI_WATCH === "true";
const forceExit =
  process.env.OPENAPI_FORCE_EXIT === "1" ||
  process.env.OPENAPI_FORCE_EXIT === "true";
const disableExit =
  process.env.OPENAPI_FORCE_EXIT === "0" ||
  process.env.OPENAPI_FORCE_EXIT === "false";

// In CI / non-watch runs we still need an explicit exit because the Hono app import keeps the event loop alive.
if (forceExit || (!isWatchMode && !disableExit)) {
  process.exit(0);
}
