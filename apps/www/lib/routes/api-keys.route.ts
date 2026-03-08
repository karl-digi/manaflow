import {
  getAccessTokenFromRequest,
  getUserFromRequest,
} from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { api } from "@cmux/convex/api";
import { ALL_API_KEYS } from "@cmux/shared";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

export const apiKeysRouter = new OpenAPIHono();

// Schema definitions
const ApiKeySchema = z
  .object({
    envVar: z.string(),
    displayName: z.string(),
    description: z.string().optional(),
    hasValue: z.boolean(),
    maskedValue: z.string().optional(),
    updatedAt: z.number().optional(),
  })
  .openapi("ApiKey");

const ApiKeyListResponse = z
  .object({
    apiKeys: z.array(ApiKeySchema),
  })
  .openapi("ApiKeyListResponse");

const UpsertApiKeyBody = z
  .object({
    envVar: z.string(),
    value: z.string(),
    displayName: z.string(),
    description: z.string().optional(),
  })
  .openapi("UpsertApiKeyBody");

const SuccessResponse = z
  .object({
    success: z.boolean(),
  })
  .openapi("SuccessResponse");

/**
 * Mask an API key value for display (show first 4 and last 4 characters)
 */
function maskApiKeyValue(value: string): string {
  if (value.length <= 12) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, 4)}${"*".repeat(8)}${value.slice(-4)}`;
}

/**
 * GET /api-keys - List all API keys with masked values
 */
apiKeysRouter.openapi(
  createRoute({
    method: "get",
    path: "/api-keys",
    tags: ["API Keys"],
    summary: "List all API keys for team (masked values)",
    request: {
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "List of API keys",
        content: {
          "application/json": {
            schema: ApiKeyListResponse,
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

    // Get stored API keys
    const storedKeys = await convex.query(api.apiKeys.getAll, { teamSlugOrId });
    const storedKeysMap = new Map(storedKeys.map((k) => [k.envVar, k]));

    // Merge with ALL_API_KEYS to show all possible keys
    const apiKeys = ALL_API_KEYS.map((keyDef) => {
      const stored = storedKeysMap.get(keyDef.envVar);
      return {
        envVar: keyDef.envVar,
        displayName: keyDef.displayName,
        description: keyDef.description,
        hasValue: !!stored,
        maskedValue: stored ? maskApiKeyValue(stored.value) : undefined,
        updatedAt: stored?.updatedAt,
      };
    });

    return c.json({ apiKeys });
  }
);

/**
 * PUT /api-keys - Upsert an API key
 */
apiKeysRouter.openapi(
  createRoute({
    method: "put",
    path: "/api-keys",
    tags: ["API Keys"],
    summary: "Create or update an API key",
    request: {
      query: z.object({
        teamSlugOrId: z.string(),
      }),
      body: {
        content: {
          "application/json": {
            schema: UpsertApiKeyBody,
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
    const body = c.req.valid("json");
    const convex = getConvex({ accessToken });

    await convex.mutation(api.apiKeys.upsert, {
      teamSlugOrId,
      envVar: body.envVar,
      value: body.value,
      displayName: body.displayName,
      description: body.description,
    });

    return c.json({ success: true });
  }
);

/**
 * DELETE /api-keys/:envVar - Remove an API key
 */
apiKeysRouter.openapi(
  createRoute({
    method: "delete",
    path: "/api-keys/{envVar}",
    tags: ["API Keys"],
    summary: "Delete an API key",
    request: {
      params: z.object({
        envVar: z.string().describe("Environment variable name"),
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

    const { envVar } = c.req.valid("param");
    const { teamSlugOrId } = c.req.valid("query");
    const convex = getConvex({ accessToken });

    await convex.mutation(api.apiKeys.remove, {
      teamSlugOrId,
      envVar,
    });

    return c.json({ success: true });
  }
);
