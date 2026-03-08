import {
  getAccessTokenFromRequest,
  getUserFromRequest,
} from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { api } from "@cmux/convex/api";
import { BASE_PROVIDERS, type ProviderSpec } from "@cmux/shared/provider-registry";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

export const providersStatusRouter = new OpenAPIHono();

// Schema definitions
const ProviderStatusSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    isAvailable: z.boolean(),
    source: z.enum(["apiKeys", "oauth", "free"]).nullable(),
    configuredKeys: z.array(z.string()),
    requiredKeys: z.array(z.string()),
  })
  .openapi("ProviderStatus");

const ProviderStatusListResponse = z
  .object({
    providers: z.array(ProviderStatusSchema),
  })
  .openapi("ProviderStatusListResponse");

/**
 * GET /providers/status - Get availability status of all providers for a team
 * Combines BASE_PROVIDERS registry with stored API keys to determine availability
 */
providersStatusRouter.openapi(
  createRoute({
    method: "get",
    path: "/providers/status",
    tags: ["Providers"],
    summary: "Get provider availability status",
    request: {
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Provider status list",
        content: {
          "application/json": {
            schema: ProviderStatusListResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const user = await getUserFromRequest(c.req.raw);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.json({ error: "Missing access token" }, 401);
    }

    const { teamSlugOrId } = c.req.valid("query");
    const convex = getConvex({ accessToken });

    // Get all API keys for this team/user
    const apiKeys = await convex.query(api.apiKeys.getAll, { teamSlugOrId });
    const configuredEnvVars = new Set(apiKeys.map((k) => k.envVar));

    // Build provider status list
    const providers = BASE_PROVIDERS.map((provider: ProviderSpec) => {
      // Check which required keys are configured
      const configuredKeys = provider.authEnvVars.filter((envVar: string) =>
        configuredEnvVars.has(envVar)
      );

      // Provider is available if at least one auth method is configured
      const isAvailable = configuredKeys.length > 0;

      // Determine source of availability
      let source: "apiKeys" | "oauth" | "free" | null = null;
      if (isAvailable) {
        // Check if using OAuth token
        if (configuredKeys.some((k: string) => k.includes("OAUTH") || k.includes("AUTH_JSON"))) {
          source = "oauth";
        } else {
          source = "apiKeys";
        }
      }

      return {
        id: provider.id,
        name: provider.name,
        isAvailable,
        source,
        configuredKeys,
        requiredKeys: provider.authEnvVars,
      };
    });

    return c.json({ providers });
  }
);
