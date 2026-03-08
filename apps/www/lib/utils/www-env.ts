import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Helper to conditionally require fields based on SANDBOX_PROVIDER
const getSandboxProviderSchema = () => {
  const provider = process.env.SANDBOX_PROVIDER;
  const isMorphRequired = !provider || provider === "morph";
  const isPveRequired = provider === "pve-lxc" || provider === "pve-vm";

  return {
    // Morph Cloud - required only if provider is "morph" or not specified
    MORPH_API_KEY: isMorphRequired
      ? z.string().min(1)
      : z.string().min(1).optional(),
    // Proxmox VE - required only if provider is "pve-lxc" or "pve-vm"
    PVE_API_URL: isPveRequired
      ? z.string().url()
      : z.string().url().optional(),
    PVE_API_TOKEN: isPveRequired
      ? z.string().min(1)
      : z.string().min(1).optional(),
  };
};

const sandboxProviderSchema = getSandboxProviderSchema();

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
    // Sandbox provider override.  Known: "morph", "pve-lxc", "pve-vm".
    // Any string accepted so external providers (e.g. "e2b") don't crash startup.
    // When unset, auto-detects from credentials or falls back to DEFAULT_SANDBOX_PROVIDER.
    SANDBOX_PROVIDER: z.string().min(1).optional(),
    // Morph Cloud - required if SANDBOX_PROVIDER is "morph" or unset
    MORPH_API_KEY: sandboxProviderSchema.MORPH_API_KEY,
    // Proxmox VE LXC - required if SANDBOX_PROVIDER is "pve-lxc" or "pve-vm"
    PVE_API_URL: sandboxProviderSchema.PVE_API_URL,
    PVE_API_TOKEN: sandboxProviderSchema.PVE_API_TOKEN,
    PVE_NODE: z.string().min(1).optional(),
    // Public domain for PVE sandbox URLs via Cloudflare Tunnel (e.g., "example.com")
    // When set, generates URLs like https://port-{port}-{instanceId}.example.com
    PVE_PUBLIC_DOMAIN: z.string().min(1).optional(),
    // Whether to verify PVE TLS certs (default: false for self-signed)
    PVE_VERIFY_TLS: z
      .string()
      .optional()
      .transform((value) => value === "1" || value?.toLowerCase() === "true"),
    OPENAI_API_KEY: z.string().min(1).optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),
    // NOTE: ANTHROPIC_API_KEY remains optional to support graceful fallback
    // when the preferred GEMINI/OPENAI providers are unavailable.
    // Used as a fallback in branch-name-generator.ts
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    CMUX_TASK_RUN_JWT_SECRET: z.string().min(1),
    // Convex HTTP actions URL (for self-hosted setups where HTTP actions are on a different port)
    // Falls back to NEXT_PUBLIC_CONVEX_URL with .convex.cloud -> .convex.site transformation
    CONVEX_SITE_URL: z.string().min(1).optional(),
    // AWS Bedrock credentials (optional - only required when spawning Claude agents)
    AWS_BEARER_TOKEN_BEDROCK: z.string().min(1).optional(),
    AWS_REGION: z.string().min(1).default("us-west-1"),
    ANTHROPIC_MODEL: z
      .string()
      .min(1)
      .default("global.anthropic.claude-opus-4-5-20251101-v1:0"),
    ANTHROPIC_SMALL_FAST_MODEL: z
      .string()
      .min(1)
      .default("us.anthropic.claude-haiku-4-5-20251001-v1:0"),
  },
  client: {
    NEXT_PUBLIC_STACK_PROJECT_ID: z.string().min(1),
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: z.string().min(1),
    NEXT_PUBLIC_CONVEX_URL: z.string().min(1),
    NEXT_PUBLIC_GITHUB_APP_SLUG: z.string().min(1).optional(),
    NEXT_PUBLIC_CMUX_PROTOCOL: z.string().min(1).optional(),
    // Base URL for the app (e.g., https://www.manaflow.com or https://cmux.dev)
    // Used for constructing URLs in client components
    NEXT_PUBLIC_BASE_APP_URL: z.string().url().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
