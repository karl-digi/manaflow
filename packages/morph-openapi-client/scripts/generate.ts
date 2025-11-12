import { createClient } from "@hey-api/openapi-ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SPEC_URL = "https://cloud.morph.so/api/openapi.json";

console.time("generate:morph-openapi-client");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const outputPath = path.join(packageRoot, "src/client");
const tsConfigPath = path.join(packageRoot, "tsconfig.json");

await fs.promises.mkdir(outputPath, { recursive: true });

console.time("fetch:morph-openapi-spec");
const response = await fetch(SPEC_URL);
if (!response.ok) {
  throw new Error(
    `Failed to download Morph Cloud OpenAPI spec: ${response.status} ${response.statusText}`
  );
}
const specPayload = await response.text();
console.timeEnd("fetch:morph-openapi-spec");

const tmpFile = path.join(
  os.tmpdir(),
  `morph-openapi-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.json`
);
fs.writeFileSync(tmpFile, specPayload);

try {
  console.time("create-client:morph-openapi");
  await createClient({
    input: tmpFile,
    output: {
      path: outputPath,
      tsConfigPath,
    },
    plugins: ["@hey-api/client-fetch", "@hey-api/typescript"],
  });
  console.timeEnd("create-client:morph-openapi");
} finally {
  try {
    fs.unlinkSync(tmpFile);
  } catch {
    // ignore
  }
}

console.timeEnd("generate:morph-openapi-client");
console.log("[morph-openapi-client] generation complete");
