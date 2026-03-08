import {
  getAccessTokenFromRequest,
  getUserFromRequest,
} from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { api } from "@cmux/convex/api";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

export const providersRouter = new OpenAPIHono();

// Schema definitions
const ApiFormatSchema = z
  .enum(["anthropic", "openai", "bedrock", "vertex", "passthrough"])
  .openapi("ApiFormat");

const FallbackSchema = z
  .object({
    modelName: z.string(),
    priority: z.number(),
  })
  .openapi("Fallback");

const ProviderOverrideSchema = z
  .object({
    _id: z.string(),
    teamId: z.string(),
    providerId: z.string(),
    baseUrl: z.string().optional(),
    apiFormat: ApiFormatSchema.optional(),
    apiKeyEnvVar: z.string().optional(),
    customHeaders: z.record(z.string(), z.string()).optional(),
    fallbacks: z.array(FallbackSchema).optional(),
    enabled: z.boolean(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .openapi("ProviderOverride");

const ProviderListResponse = z
  .object({
    providers: z.array(ProviderOverrideSchema),
  })
  .openapi("ProviderListResponse");

const UpsertProviderBody = z
  .object({
    baseUrl: z.string().optional(),
    apiFormat: ApiFormatSchema.optional(),
    apiKeyEnvVar: z.string().optional(),
    customHeaders: z.record(z.string(), z.string()).optional(),
    fallbacks: z.array(FallbackSchema).optional(),
    enabled: z.boolean(),
  })
  .openapi("UpsertProviderBody");

const SuccessResponse = z
  .object({
    success: z.boolean(),
  })
  .openapi("SuccessResponse");

const UpsertResponse = z
  .object({
    id: z.string(),
    action: z.enum(["created", "updated"]),
  })
  .openapi("UpsertResponse");

const TestResponse = z
  .object({
    success: z.boolean(),
    latencyMs: z.number().optional(),
    error: z.string().optional(),
  })
  .openapi("TestResponse");

/**
 * GET /providers - List all provider overrides for a team
 */
providersRouter.openapi(
  createRoute({
    method: "get",
    path: "/providers",
    tags: ["Providers"],
    summary: "List provider overrides for team",
    request: {
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "List of provider overrides",
        content: {
          "application/json": {
            schema: ProviderListResponse,
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

    const providers = await convex.query(api.providerOverrides.getForTeam, {
      teamSlugOrId,
    });

    return c.json({ providers });
  }
);

/**
 * GET /providers/:id - Get a specific provider override
 */
providersRouter.openapi(
  createRoute({
    method: "get",
    path: "/providers/{id}",
    tags: ["Providers"],
    summary: "Get a specific provider override",
    request: {
      params: z.object({
        id: z.string().describe("Provider ID (e.g., anthropic, openai)"),
      }),
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Provider override",
        content: {
          "application/json": {
            schema: ProviderOverrideSchema.nullable(),
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

    const { id } = c.req.valid("param");
    const { teamSlugOrId } = c.req.valid("query");
    const convex = getConvex({ accessToken });

    const provider = await convex.query(api.providerOverrides.getByProvider, {
      teamSlugOrId,
      providerId: id,
    });

    return c.json(provider);
  }
);

/**
 * PUT /providers/:id - Upsert a provider override
 */
providersRouter.openapi(
  createRoute({
    method: "put",
    path: "/providers/{id}",
    tags: ["Providers"],
    summary: "Create or update a provider override",
    request: {
      params: z.object({
        id: z.string().describe("Provider ID (e.g., anthropic, openai)"),
      }),
      query: z.object({
        teamSlugOrId: z.string(),
      }),
      body: {
        content: {
          "application/json": {
            schema: UpsertProviderBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: UpsertResponse,
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

    const { id } = c.req.valid("param");
    const { teamSlugOrId } = c.req.valid("query");
    const body = c.req.valid("json");
    const convex = getConvex({ accessToken });

    const result = await convex.mutation(api.providerOverrides.upsert, {
      teamSlugOrId,
      providerId: id,
      baseUrl: body.baseUrl,
      apiFormat: body.apiFormat,
      apiKeyEnvVar: body.apiKeyEnvVar,
      customHeaders: body.customHeaders,
      fallbacks: body.fallbacks,
      enabled: body.enabled,
    });

    return c.json(result);
  }
);

/**
 * DELETE /providers/:id - Remove a provider override
 */
providersRouter.openapi(
  createRoute({
    method: "delete",
    path: "/providers/{id}",
    tags: ["Providers"],
    summary: "Delete a provider override",
    request: {
      params: z.object({
        id: z.string().describe("Provider ID (e.g., anthropic, openai)"),
      }),
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: SuccessResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
      404: { description: "Provider override not found" },
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

    const { id } = c.req.valid("param");
    const { teamSlugOrId } = c.req.valid("query");
    const convex = getConvex({ accessToken });

    try {
      await convex.mutation(api.providerOverrides.remove, {
        teamSlugOrId,
        providerId: id,
      });
      return c.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      throw error;
    }
  }
);

/**
 * POST /providers/:id/test - Test connectivity to a provider endpoint
 */
providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/{id}/test",
    tags: ["Providers"],
    summary: "Test provider connectivity",
    request: {
      params: z.object({
        id: z.string().describe("Provider ID (e.g., anthropic, openai)"),
      }),
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Test result",
        content: {
          "application/json": {
            schema: TestResponse,
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

    const { id } = c.req.valid("param");
    const { teamSlugOrId } = c.req.valid("query");
    const convex = getConvex({ accessToken });

    // Get the provider override configuration
    const provider = await convex.query(api.providerOverrides.getByProvider, {
      teamSlugOrId,
      providerId: id,
    });

    if (!provider || !provider.baseUrl) {
      return c.json({
        success: false,
        error: "Provider override not found or has no base URL configured",
      });
    }

    // Test connectivity to the provider endpoint
    const startTime = Date.now();
    try {
      const response = await fetch(provider.baseUrl, {
        method: "HEAD",
        headers: provider.customHeaders ?? {},
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      const latencyMs = Date.now() - startTime;

      // Consider 2xx and 4xx (like 401/403) as "reachable" since the endpoint exists
      if (response.ok || response.status < 500) {
        return c.json({
          success: true,
          latencyMs,
        });
      } else {
        return c.json({
          success: false,
          latencyMs,
          error: `HTTP ${response.status}: ${response.statusText}`,
        });
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      return c.json({
        success: false,
        latencyMs,
        error: error instanceof Error ? error.message : "Connection failed",
      });
    }
  }
);

/**
 * PATCH /providers/:id/enabled - Toggle provider enabled state
 */
providersRouter.openapi(
  createRoute({
    method: "patch",
    path: "/providers/{id}/enabled",
    tags: ["Providers"],
    summary: "Toggle provider enabled state",
    request: {
      params: z.object({
        id: z.string().describe("Provider ID"),
      }),
      query: z.object({
        teamSlugOrId: z.string(),
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              enabled: z.boolean(),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: SuccessResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
      404: { description: "Provider override not found" },
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

    const { id } = c.req.valid("param");
    const { teamSlugOrId } = c.req.valid("query");
    const { enabled } = c.req.valid("json");
    const convex = getConvex({ accessToken });

    try {
      await convex.mutation(api.providerOverrides.setEnabled, {
        teamSlugOrId,
        providerId: id,
        enabled,
      });
      return c.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      throw error;
    }
  }
);
