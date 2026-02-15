#!/usr/bin/env bun
/**
 * Development build script for cmux-devbox-lite E2B template.
 * Uses the E2B SDK v2 programmatic API to build templates.
 *
 * Dev builds publish to "cmux-devbox-lite-dev" to avoid overwriting
 * the production template (cmux-devbox-lite) with smaller resources.
 */

import { buildTemplate } from "./template";

async function main() {
  console.log("[build.dev] Starting development template build...");
  console.log("[build.dev] Publishing to: cmux-devbox-lite-dev (not production)");

  try {
    const result = await buildTemplate({
      mode: "dev",
      // Dev builds use smaller resources for faster iteration
      cpuCount: 4,
      memoryMB: 8192,
    });

    console.log("[build.dev] Template built successfully!");
    console.log(`  Template ID: ${result.templateId}`);
    console.log(`  Build ID: ${result.buildId}`);
    console.log(`  Name: ${result.name}`);
  } catch (error) {
    console.error("[build.dev] Template build failed:", error);
    process.exit(1);
  }
}

main();
