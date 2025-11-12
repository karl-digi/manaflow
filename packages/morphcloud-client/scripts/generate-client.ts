import { createClient } from "@hey-api/openapi-ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

console.time("generate-morphcloud-client");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.time("fetch morphcloud openapi spec");
const response = await fetch("https://cloud.morph.so/api/openapi.json");
if (!response.ok) {
  throw new Error(
    `Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`
  );
}
const spec = await response.text();
console.timeEnd("fetch morphcloud openapi spec");

const outputPath = path.join(__dirname, "../src/client");
const tsConfigPath = path.join(__dirname, "../tsconfig.json");

// write to tmp file (unique name to avoid concurrent collisions)
const tmpFile = path.join(
  os.tmpdir(),
  `morphcloud-openapi-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
);
fs.writeFileSync(tmpFile, spec);

console.time("generate client");
await createClient({
  input: tmpFile,
  output: {
    path: outputPath,
    tsConfigPath,
  },
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript"],
});
console.timeEnd("generate client");

try {
  fs.unlinkSync(tmpFile);
} catch {
  // ignore if already removed by concurrent runs
}

console.timeEnd("generate-morphcloud-client");
console.log("[generate-morphcloud-client] client generation complete");
