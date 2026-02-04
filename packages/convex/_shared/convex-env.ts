import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    STACK_WEBHOOK_SECRET: z.string().min(1),
    // Stack Admin keys for backfills and server-side operations
    STACK_SECRET_SERVER_KEY: z.string().min(1).optional(),
    STACK_SUPER_SECRET_ADMIN_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_STACK_PROJECT_ID: z.string().optional(),
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: z.string().optional(),
    GITHUB_APP_WEBHOOK_SECRET: z.string().min(1).optional(),
    INSTALL_STATE_SECRET: z.string().min(1).optional(),
    CMUX_GITHUB_APP_ID: z.string().min(1).optional(),
    CMUX_GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_CMUX_PROTOCOL: z.string().min(1).optional(),
    BASE_APP_URL: z.string().min(1),
    CMUX_TASK_RUN_JWT_SECRET: z.string().min(1),
    // Note: OPENAI_API_KEY is accessed via process.env directly in crown/actions.ts
    // to allow deployments without forcing an OpenAI key. Keep other AI keys optional
    // so Convex does not require them. Anthropic/Bedrock/Vertex are also read via
    // process.env where needed, so omit them here to avoid validation requirements.
    MORPH_API_KEY: z.string().min(1).optional(),
    // Note: PVE_* variables are accessed via process.env directly in
    // sandboxInstanceMaintenance.ts to avoid Convex static analysis
    // requiring them to be set in all deployments
    // Note: CMUX_IS_STAGING was removed - preview_jobs_worker.ts now hardcodes
    // CMUX_IS_STAGING="false" in sandbox env to always use production releases
    CONVEX_IS_PRODUCTION: z.string().optional(),
    // Opt-in flags for expensive preview/screenshot features (disabled by default)
    // Set to "true" or "1" to enable
    CMUX_ENABLE_PREVIEW_RUNS: z.string().min(1).optional(),
    CMUX_ENABLE_SCREENSHOT_WORKFLOW: z.string().min(1).optional(),
    POSTHOG_API_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
