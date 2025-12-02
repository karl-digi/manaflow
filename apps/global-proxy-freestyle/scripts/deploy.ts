#!/usr/bin/env bun
/**
 * Deploy global-proxy-freestyle to Freestyle's edge deployment platform.
 *
 * Usage:
 *   bun run deploy
 *
 * Environment variables:
 *   FREESTYLE_API_KEY: Required. Your Freestyle API key.
 *   FREESTYLE_API_BASE_URL: Optional. Defaults to https://api.freestyle.sh
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFreestyleClient,
  handleDeployWebV2,
  handleInsertDomainMapping,
} from "@cmux/freestyle-openapi-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const FREESTYLE_API_KEY = process.env.FREESTYLE_API_KEY;
const FREESTYLE_API_BASE_URL =
  process.env.FREESTYLE_API_BASE_URL ?? "https://api.freestyle.sh";

// Domain to deploy to (must be verified in Freestyle)
const DEPLOY_DOMAIN = "f.cmux.sh";

async function main() {
  if (!FREESTYLE_API_KEY) {
    console.error(
      "FREESTYLE_API_KEY is required. Export it before running this script."
    );
    process.exit(1);
  }

  const client = createFreestyleClient({
    baseUrl: FREESTYLE_API_BASE_URL,
    headers: {
      Authorization: `Bearer ${FREESTYLE_API_KEY}`,
    },
  });

  // Read the source file
  const indexPath = join(PROJECT_ROOT, "src", "index.ts");
  const indexContent = await readFile(indexPath, "utf-8");

  console.log("[Deploy] Deploying global-proxy-freestyle...");
  console.log(`[Deploy] Source file: ${indexPath}`);
  console.log(`[Deploy] Target domain: ${DEPLOY_DOMAIN}`);

  const deployResponse = await handleDeployWebV2({
    client,
    body: {
      source: {
        kind: "files",
        files: {
          "index.ts": {
            content: indexContent,
            encoding: "utf-8",
          },
        },
      },
      config: {
        // domains: [DEPLOY_DOMAIN],  // Causes INTERNAL_ERROR, map separately
        entrypoint: "index.ts",
        envVars: {},
        timeout: 30000,
        serverStartCheck: true,
        networkPermissions: [
          {
            query: "*.http.cloud.morph.so",
            action: "allow",
          },
          {
            query: "*.vm.freestyle.sh",
            action: "allow",
          },
        ],
        await: true,
      },
    },
  });

  if (deployResponse.error) {
    console.error("[Deploy] Failed to deploy:", deployResponse.error);
    process.exit(1);
  }

  const result = deployResponse.data;
  if (!result) {
    console.error("[Deploy] No data in response");
    process.exit(1);
  }

  console.log("[Deploy] Deployment successful!");
  console.log(`[Deploy] Deployment ID: ${result.deploymentId}`);
  if ("domains" in result && result.domains) {
    console.log(`[Deploy] Domains: ${result.domains.join(", ")}`);
  }

  // Map the domain to this deployment
  console.log(`\n[Deploy] Mapping domain ${DEPLOY_DOMAIN} to deployment...`);

  const mappingResponse = await handleInsertDomainMapping({
    client,
    path: {
      domain: DEPLOY_DOMAIN,
    },
    body: {
      deploymentId: result.deploymentId,
    },
  });

  if (mappingResponse.error) {
    console.error("[Deploy] Failed to map domain:", mappingResponse.error);
    console.log(
      "[Deploy] Note: The deployment is live, but domain mapping failed."
    );
    console.log(
      "[Deploy] You may need to verify domain ownership first. Run:"
    );
    console.log(`  bun run scripts/verify-domain.ts ${DEPLOY_DOMAIN}`);
  } else if (
    mappingResponse.data &&
    typeof mappingResponse.data === "object" &&
    "type" in mappingResponse.data &&
    mappingResponse.data.type === "failedToProvisionCertificate"
  ) {
    console.error("[Deploy] Certificate provisioning failed:");
    console.error(
      "[Deploy]",
      (mappingResponse.data as { message?: string }).message
    );
    console.log("[Deploy] The deployment is live but SSL is not ready.");
    console.log("[Deploy] This may be a Freestyle infrastructure issue.");
    console.log("[Deploy] Wait a few minutes and retry, or contact support.");
  } else {
    console.log("[Deploy] Domain mapped successfully!");
    console.log(`[Deploy] Your proxy is now live at: https://${DEPLOY_DOMAIN}`);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
