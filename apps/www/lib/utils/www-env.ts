import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "NEXT_PUBLIC_",
  server: {
    // Stack server-side env
    STACK_SECRET_SERVER_KEY: z.string().min(1),
    STACK_SUPER_SECRET_ADMIN_KEY: z.string().min(1),
    STACK_DATA_VAULT_SECRET: z.string().min(32), // For secure DataBook storage
    // GitHub App
    CMUX_GITHUB_APP_ID: z.string().min(1),
    CMUX_GITHUB_APP_PRIVATE_KEY: z.string().min(1),
    // Sandbox providers (at least one required)
    // Explicit provider selection: "morph" or "proxmox" (auto-detect if not set)
    SANDBOX_PROVIDER: z.enum(["morph", "proxmox"]).optional(),
    // Morph Cloud - original provider
    MORPH_API_KEY: z.string().min(1).optional(),
    // Proxmox VE LXC - self-hosted alternative
    PVE_API_URL: z.string().url().optional(),
    PVE_API_TOKEN: z.string().min(1).optional(),
    PVE_NODE: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1),
    CMUX_TASK_RUN_JWT_SECRET: z.string().min(1),
    // Convex HTTP actions URL (for self-hosted setups where HTTP actions are on a different port)
    // Falls back to NEXT_PUBLIC_CONVEX_URL with .convex.cloud -> .convex.site transformation
    CONVEX_SITE_URL: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_STACK_PROJECT_ID: z.string().min(1),
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: z.string().min(1),
    NEXT_PUBLIC_CONVEX_URL: z.string().min(1),
    NEXT_PUBLIC_GITHUB_APP_SLUG: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
