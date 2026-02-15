#!/usr/bin/env bun
/**
 * Production build script for cmux-devbox-lite E2B template.
 * Uses the E2B SDK v2 programmatic API to build templates.
 *
 * Prod builds publish to "cmux-devbox-lite" (the canonical template name).
 * Use this for official releases only.
 */

import { buildTemplate } from "./template";

async function main() {
  console.log("[build.prod] Starting production template build...");
  console.log("[build.prod] Publishing to: cmux-devbox-lite (production)");

  try {
    const result = await buildTemplate({
      mode: "prod",
      // Production builds use full resources
      cpuCount: 4,
      memoryMB: 16384,
    });

    console.log("[build.prod] Template built successfully!");
    console.log(`  Template ID: ${result.templateId}`);
    console.log(`  Build ID: ${result.buildId}`);
    console.log(`  Name: ${result.name}`);
  } catch (error) {
    console.error("[build.prod] Template build failed:", error);
    process.exit(1);
  }
}

main();
