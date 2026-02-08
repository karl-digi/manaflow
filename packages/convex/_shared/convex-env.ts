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
    // to allow deployments without forcing an OpenAI key.
    // These remain optional so Convex does not require them in all deployments.
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    AWS_BEARER_TOKEN_BEDROCK: z.string().min(1).optional(),
    MORPH_API_KEY: z.string().min(1).optional(),
    // Note: PVE_* variables are accessed via process.env directly in
    // sandboxInstanceMaintenance.ts to avoid Convex static analysis
    // requiring them to be set in all deployments
    E2B_API_KEY: z.string().min(1).optional(),
    MODAL_TOKEN_ID: z.string().min(1).optional(),
    MODAL_TOKEN_SECRET: z.string().min(1).optional(),
    MODAL_SNAPSHOT_IMAGE_ID: z.string().min(1).optional(),
    // Controls which screenshot collector release is downloaded by screenshotCollectorLoader.ts:
    // - "true": Downloads staging/development releases (for testing new collector versions)
    // - "false" or unset: Downloads production releases (default, used by preview_jobs_worker.ts)
    CMUX_IS_STAGING: z.string().optional(),
    CONVEX_IS_PRODUCTION: z.string().optional(),
    // Opt-in flag for screenshot workflow (disabled by default)
    // Set to "true" or "1" to enable screenshot capture for task runs and PR previews
    CMUX_ENABLE_SCREENSHOT_WORKFLOW: z.string().min(1).optional(),
    POSTHOG_API_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
