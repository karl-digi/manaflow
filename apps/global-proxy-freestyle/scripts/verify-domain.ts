#!/usr/bin/env bun
/**
 * Verify domain ownership with Freestyle.
 *
 * Usage:
 *   bun run scripts/verify-domain.ts <domain>
 *
 * This will:
 * 1. Create a domain verification request
 * 2. Show you the TXT record to add to your DNS
 * 3. Optionally verify once the record is added
 */

import {
  createFreestyleClient,
  handleCreateDomainVerification,
  handleListDomainVerificationRequests,
  handleVerifyDomain,
} from "@cmux/freestyle-openapi-client";

const FREESTYLE_API_KEY = process.env.FREESTYLE_API_KEY;
const FREESTYLE_API_BASE_URL =
  process.env.FREESTYLE_API_BASE_URL ?? "https://api.freestyle.sh";

async function main() {
  const domain = process.argv[2];

  if (!domain) {
    console.error("Usage: bun run scripts/verify-domain.ts <domain>");
    process.exit(1);
  }

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

  // Check if we should verify or create
  const action = process.argv[3];

  if (action === "verify") {
    console.log(`[Domain] Verifying domain: ${domain}`);

    const verifyResponse = await handleVerifyDomain({
      client,
      body: {
        domain,
      },
    });

    if (verifyResponse.error) {
      console.error("[Domain] Verification failed:", verifyResponse.error);
      process.exit(1);
    }

    console.log("[Domain] Domain verified successfully!");
    console.log("[Domain] Response:", verifyResponse.data);
    return;
  }

  // List existing verifications
  console.log(`[Domain] Checking existing verifications for: ${domain}`);

  const listResponse = await handleListDomainVerificationRequests({
    client,
  });

  if (listResponse.error) {
    console.error("[Domain] Failed to list verifications:", listResponse.error);
  } else if (listResponse.data && listResponse.data.length > 0) {
    // Filter to the requested domain
    const domainRequests = listResponse.data.filter((r) => r.domain === domain);
    if (domainRequests.length > 0) {
      console.log("[Domain] Existing verification requests:");
      for (const req of domainRequests) {
        console.log(`  - Domain: ${req.domain}`);
        console.log(`    Code: ${req.verificationCode}`);
        console.log(`    Created: ${req.createdAt}`);
      }
      console.log("\n[Domain] To verify, add a TXT record:");
      console.log(`  Name: _freestyle-verification.${domain}`);
      console.log(`  Value: ${domainRequests[0].verificationCode}`);
      console.log("\n[Domain] Then run:");
      console.log(`  bun run scripts/verify-domain.ts ${domain} verify`);
      return;
    }
  }

  // Create new verification request
  console.log(`[Domain] Creating verification request for: ${domain}`);

  const createResponse = await handleCreateDomainVerification({
    client,
    body: {
      domain,
    },
  });

  if (createResponse.error) {
    console.error("[Domain] Failed to create verification:", createResponse.error);
    process.exit(1);
  }

  const result = createResponse.data;
  if (!result) {
    console.error("[Domain] No data in response");
    process.exit(1);
  }
  console.log("[Domain] Verification request created!");
  console.log("\n[Domain] Add this TXT record to your DNS:");
  console.log(`  Name: _freestyle-verification.${domain}`);
  console.log(`  Value: ${result.verificationCode}`);
  console.log("\n[Domain] Once added, run:");
  console.log(`  bun run scripts/verify-domain.ts ${domain} verify`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
