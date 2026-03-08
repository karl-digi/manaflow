import { getAccessTokenFromRequest, getUserFromRequest } from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { api } from "@cmux/convex/api";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

export const modelsRouter = new OpenAPIHono();

// Schema definitions
const ModelSchema = z
  .object({
    _id: z.string(),
    name: z.string(),
    displayName: z.string(),
    vendor: z.string(),
    source: z.enum(["curated", "discovered"]),
    discoveredFrom: z.string().optional(),
    discoveredAt: z.number().optional(),
    requiredApiKeys: z.array(z.string()),
    tier: z.enum(["free", "paid"]),
    tags: z.array(z.string()),
    enabled: z.boolean(),
    sortOrder: z.number(),
    disabled: z.boolean().optional(),
    disabledReason: z.string().optional(),
    hiddenForTeam: z.boolean(),
    variants: z
      .array(
        z.object({
          id: z.string(),
          displayName: z.string(),
          description: z.string().optional(),
        })
      )
      .optional(),
    defaultVariant: z.string().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .openapi("Model");

const ModelListResponse = z
  .object({
    models: z.array(ModelSchema),
  })
  .openapi("ModelListResponse");

const SetEnabledBody = z
  .object({
    enabled: z.boolean(),
  })
  .openapi("SetEnabledBody");

const ReorderBody = z
  .object({
    modelNames: z.array(z.string()),
  })
  .openapi("ReorderBody");

const SuccessResponse = z
  .object({
    success: z.boolean(),
  })
  .openapi("SuccessResponse");

const DiscoveryResultResponse = z
  .object({
    success: z.boolean(),
    curated: z.number().optional(),
    discovered: z.number().optional(),
    free: z.number().optional(),
    paid: z.number().optional(),
    openrouter: z
      .object({
        discovered: z.number(),
        free: z.number(),
        paid: z.number(),
      })
      .optional(),
    error: z.string().optional(),
  })
  .openapi("DiscoveryResultResponse");

/**
 * GET /models - List all models (admin view)
 * Returns all models including disabled ones for admin management.
 */
modelsRouter.openapi(
  createRoute({
    method: "get",
    path: "/models",
    tags: ["Models"],
    summary: "List all models for admin management",
    request: {
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "List of all models",
        content: {
          "application/json": {
            schema: ModelListResponse,
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

    const models = await convex.query(api.models.listAll, { teamSlugOrId });

    return c.json({
      models: models.map((model) => ({
        ...model,
        hiddenForTeam: model.hiddenForTeam ?? false,
      })),
    });
  }
);

/**
 * PATCH /models/:name/enabled - Toggle model visibility for the current team
 */
modelsRouter.openapi(
  createRoute({
    method: "patch",
    path: "/models/{name}/enabled",
    tags: ["Models"],
    summary: "Toggle model visibility for the current team",
    request: {
      params: z.object({
        name: z.string().describe("Model name (URL-encoded)"),
      }),
      query: z.object({
        teamSlugOrId: z.string(),
      }),
      body: {
        content: {
          "application/json": {
            schema: SetEnabledBody,
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
      404: { description: "Model not found" },
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

    const { name } = c.req.valid("param");
    const { teamSlugOrId } = c.req.valid("query");
    const { enabled: visible } = c.req.valid("json");

    // Decode URL-encoded model name (e.g., "claude%2Fopus-4.6" -> "claude/opus-4.6")
    const modelName = decodeURIComponent(name);
    const convex = getConvex({ accessToken });

    try {
      await convex.mutation(api.teamModelVisibility.toggleModel, {
        teamSlugOrId,
        modelName,
        hidden: !visible,
      });
      return c.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update model visibility";
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      throw error;
    }
  }
);

/**
 * POST /models/reorder - Reorder models via drag-and-drop
 */
modelsRouter.openapi(
  createRoute({
    method: "post",
    path: "/models/reorder",
    tags: ["Models"],
    summary: "Reorder models",
    request: {
      query: z.object({
        teamSlugOrId: z.string(),
      }),
      body: {
        content: {
          "application/json": {
            schema: ReorderBody,
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
    const { modelNames } = c.req.valid("json");
    const convex = getConvex({ accessToken });

    await convex.mutation(api.models.reorder, {
      teamSlugOrId,
      modelNames,
    });

    return c.json({ success: true });
  }
);

/**
 * POST /models/refresh - Trigger model discovery
 * Runs the full discovery process: seeds curated models and discovers from OpenCode.
 */
modelsRouter.openapi(
  createRoute({
    method: "post",
    path: "/models/refresh",
    tags: ["Models"],
    summary: "Trigger model discovery",
    request: {
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Discovery result",
        content: {
          "application/json": {
            schema: DiscoveryResultResponse,
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

    // Run full refresh (seed + discover)
    try {
      const result = await convex.action(
        api.modelDiscovery.triggerRefresh,
        { teamSlugOrId }
      );

      return c.json({
        success: result.success,
        curated: result.curated,
        discovered: result.discovered,
        free: result.free,
        paid: result.paid,
        openrouter: result.openrouter,
      });
    } catch (error) {
      console.error("[models.route] Discovery failed:", error);
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : "Discovery failed",
      });
    }
  }
);

/**
 * POST /models/seed - Seed curated models only
 */
modelsRouter.openapi(
  createRoute({
    method: "post",
    path: "/models/seed",
    tags: ["Models"],
    summary: "Seed curated models from AGENT_CATALOG",
    request: {
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Seed result",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              seededCount: z.number(),
              error: z.string().optional(),
            }),
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

    try {
      const result = await convex.action(
        api.modelDiscovery.triggerSeed,
        { teamSlugOrId }
      );

      return c.json({
        success: result.success,
        seededCount: result.seededCount,
      });
    } catch (error) {
      console.error("[models.route] Seeding failed:", error);
      return c.json({
        success: false,
        seededCount: 0,
        error: error instanceof Error ? error.message : "Seeding failed",
      });
    }
  }
);
