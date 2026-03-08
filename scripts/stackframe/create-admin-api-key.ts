#!/usr/bin/env bun
/**
 * Create a Stack Auth Admin API Key using StackServerApp.
 *
 * Usage:
 *   bun run --env-file .env.production scripts/stackframe/create-admin-api-key.ts <user-id>
 *
 * Example:
 *   bun run --env-file .env.production scripts/stackframe/create-admin-api-key.ts 12345678
 *
 * This creates an API key for the specified admin user, which can be used as
 * STACK_SUPER_SECRET_ADMIN_KEY for StackAdminApp.
 *
 * Required environment variables:
 *   - NEXT_PUBLIC_STACK_PROJECT_ID
 *   - NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY
 *   - STACK_SECRET_SERVER_KEY
 */

import { StackServerApp } from "@stackframe/js";

const userId = process.argv[2];

if (!userId) {
  console.error("Usage: bun run scripts/stackframe/create-admin-api-key.ts <user-id>");
  console.error("");
  console.error("Example:");
  console.error("  bun run --env-file .env.production scripts/stackframe/create-admin-api-key.ts 2899124e-7722-4828-b4ab-ad65a6829934");
  process.exit(1);
}

const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
const publishableClientKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;
const secretServerKey = process.env.STACK_SECRET_SERVER_KEY;

if (!projectId || !publishableClientKey || !secretServerKey) {
  console.error("Missing required environment variables:");
  if (!projectId) console.error("  - NEXT_PUBLIC_STACK_PROJECT_ID");
  if (!publishableClientKey) console.error("  - NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY");
  if (!secretServerKey) console.error("  - STACK_SECRET_SERVER_KEY");
  process.exit(1);
}

console.log("Creating admin API key...");
console.log("Project ID:", projectId);
console.log("User ID:", userId);
console.log("");

const stackServerApp = new StackServerApp({
  tokenStore: "memory",
  projectId,
  publishableClientKey,
  secretServerKey,
});

const user = await stackServerApp.getUser(userId);

if (!user) {
  console.error(`Error: User not found with ID: ${userId}`);
  console.error("");
  console.error("Make sure:");
  console.error("  1. The user exists in your Stack Auth project");
  console.error("  2. You're using the correct .env file");
  process.exit(1);
}

console.log("Found user:", user.displayName || user.primaryEmail || userId);

const apiKey = await user.createApiKey({
  description: "CMUX Admin API Key",
  expiresAt: null, // Never expires
});

console.log("");
console.log("=".repeat(60));
console.log("Admin API Key created successfully!");
console.log("=".repeat(60));
console.log("");
console.log("Add this to your .env file:");
console.log("");
console.log(`STACK_SUPER_SECRET_ADMIN_KEY=${apiKey.value}`);
console.log("");
console.log("=".repeat(60));
