import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { stackServerAppJs } from "@/lib/utils/stack";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { env } from "@/lib/utils/www-env";
import { api } from "@cmux/convex/api";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { randomBytes } from "node:crypto";

export const workspaceConfigsRouter = new OpenAPIHono();

const WorkspaceConfigResponse = z
  .object({
    projectFullName: z.string(),
    maintenanceScript: z.string().optional(),
    envVarsContent: z.string(),
    updatedAt: z.number().optional(),
  })
  .openapi("WorkspaceConfigResponse");

const WorkspaceConfigQuery = z
  .object({
    teamSlugOrId: z.string(),
    projectFullName: z.string(),
  })
  .openapi("WorkspaceConfigQuery");

const WorkspaceConfigBody = z
  .object({
    teamSlugOrId: z.string(),
    projectFullName: z.string(),
    maintenanceScript: z.string().optional(),
    envVarsContent: z.string().default(""),
  })
  .openapi("WorkspaceConfigBody");

async function loadEnvVarsContent(
  dataVaultKey: string | undefined,
): Promise<string> {
  if (!dataVaultKey) return "";
  const store = await stackServerAppJs.getDataVaultStore("cmux-snapshot-envs");
  const value = await store.getValue(dataVaultKey, {
    secret: env.STACK_DATA_VAULT_SECRET,
  });
  return value ?? "";
}

workspaceConfigsRouter.openapi(
  createRoute({
    method: "get",
    path: "/workspace-configs",
    summary: "Get workspace configuration",
    tags: ["WorkspaceConfigs"],
    request: {
      query: WorkspaceConfigQuery,
    },
    responses: {
      200: {
        description: "Configuration retrieved",
        content: {
          "application/json": {
            schema: WorkspaceConfigResponse.nullable(),
          },
        },
      },
      400: { description: "Bad request - invalid parameters" },
      401: { description: "Unauthorized - authentication required" },
      403: { description: "Forbidden - not a member of the team" },
      503: { description: "Service unavailable - database or storage service down" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      throw new HTTPException(401, {
        message: "Authentication required. Please sign in to access workspace configurations.",
      });
    }

    const query = c.req.valid("query");

    if (!query.projectFullName || query.projectFullName.trim() === "") {
      throw new HTTPException(400, {
        message: "Invalid request: projectFullName is required and cannot be empty.",
      });
    }

    try {
      await verifyTeamAccess({
        req: c.req.raw,
        teamSlugOrId: query.teamSlugOrId,
      });
    } catch (error) {
      // verifyTeamAccess throws HTTPException with descriptive messages
      throw error;
    }

    const convex = getConvex({ accessToken });

    let config;
    try {
      config = await convex.query(api.workspaceConfigs.get, {
        teamSlugOrId: query.teamSlugOrId,
        projectFullName: query.projectFullName,
      });
    } catch (error) {
      console.error("[workspace-configs] Failed to query Convex:", error);
      throw new HTTPException(503, {
        message: "Database service temporarily unavailable. Please try again in a few moments.",
        cause: error,
      });
    }

    if (!config) {
      return c.json(null);
    }

    let envVarsContent;
    try {
      envVarsContent = await loadEnvVarsContent(config.dataVaultKey);
    } catch (error) {
      console.error("[workspace-configs] Failed to load env vars from data vault:", error);
      throw new HTTPException(503, {
        message: "Failed to retrieve environment variables from secure storage. Please try again later.",
        cause: error,
      });
    }

    return c.json({
      projectFullName: config.projectFullName,
      maintenanceScript: config.maintenanceScript ?? undefined,
      envVarsContent,
      updatedAt: config.updatedAt,
    });
  },
);

workspaceConfigsRouter.openapi(
  createRoute({
    method: "post",
    path: "/workspace-configs",
    summary: "Create or update workspace configuration",
    tags: ["WorkspaceConfigs"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: WorkspaceConfigBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Configuration saved",
        content: {
          "application/json": {
            schema: WorkspaceConfigResponse,
          },
        },
      },
      400: { description: "Bad request - invalid parameters" },
      401: { description: "Unauthorized - authentication required" },
      403: { description: "Forbidden - not a member of the team" },
      503: { description: "Service unavailable - database or storage service down" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      throw new HTTPException(401, {
        message: "Authentication required. Please sign in to save workspace configurations.",
      });
    }

    const body = c.req.valid("json");

    if (!body.projectFullName || body.projectFullName.trim() === "") {
      throw new HTTPException(400, {
        message: "Invalid request: projectFullName is required and cannot be empty.",
      });
    }

    try {
      await verifyTeamAccess({
        req: c.req.raw,
        teamSlugOrId: body.teamSlugOrId,
      });
    } catch (error) {
      // verifyTeamAccess throws HTTPException with descriptive messages
      throw error;
    }

    const convex = getConvex({ accessToken });

    let existing;
    try {
      existing = await convex.query(api.workspaceConfigs.get, {
        teamSlugOrId: body.teamSlugOrId,
        projectFullName: body.projectFullName,
      });
    } catch (error) {
      console.error("[workspace-configs] Failed to query existing config from Convex:", error);
      throw new HTTPException(503, {
        message: "Database service temporarily unavailable. Please try again in a few moments.",
        cause: error,
      });
    }

    let store;
    try {
      store = await stackServerAppJs.getDataVaultStore("cmux-snapshot-envs");
    } catch (error) {
      console.error("[workspace-configs] Failed to initialize data vault store:", error);
      throw new HTTPException(503, {
        message: "Secure storage service temporarily unavailable. Please try again later.",
        cause: error,
      });
    }

    const envVarsContent = body.envVarsContent ?? "";
    let dataVaultKey = existing?.dataVaultKey;
    if (!dataVaultKey) {
      dataVaultKey = `workspace_${randomBytes(16).toString("hex")}`;
    }

    try {
      await store.setValue(dataVaultKey, envVarsContent, {
        secret: env.STACK_DATA_VAULT_SECRET,
      });
    } catch (error) {
      console.error("[workspace-configs] Failed to save env vars to data vault:", error);
      throw new HTTPException(503, {
        message: "Failed to persist environment variables to secure storage. Please verify your data vault configuration and try again.",
        cause: error,
      });
    }

    try {
      await convex.mutation(api.workspaceConfigs.upsert, {
        teamSlugOrId: body.teamSlugOrId,
        projectFullName: body.projectFullName,
        maintenanceScript: body.maintenanceScript,
        dataVaultKey,
      });
    } catch (error) {
      console.error("[workspace-configs] Failed to save config to Convex:", error);
      throw new HTTPException(503, {
        message: "Database service temporarily unavailable. Configuration may not have been saved. Please try again.",
        cause: error,
      });
    }

    return c.json({
      projectFullName: body.projectFullName,
      maintenanceScript: body.maintenanceScript,
      envVarsContent,
      updatedAt: Date.now(),
    });
  },
);
