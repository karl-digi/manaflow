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
  context: string,
): Promise<string> {
  if (!dataVaultKey) return "";
  try {
    const store = await stackServerAppJs.getDataVaultStore(
      "cmux-snapshot-envs",
    );
    const value = await store.getValue(dataVaultKey, {
      secret: env.STACK_DATA_VAULT_SECRET,
    });
    return value ?? "";
  } catch (error) {
    throw new HTTPException(500, {
      message: `${context} Failed to read workspace environment variables`,
      cause: error,
    });
  }
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
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const query = c.req.valid("query");
    const context = `[workspace-configs.get team=${query.teamSlugOrId} project=${query.projectFullName}]`;

    await verifyTeamAccess({
      req: c.req.raw,
      teamSlugOrId: query.teamSlugOrId,
    });

    const convex = getConvex({ accessToken });
    let config;
    try {
      config = await convex.query(api.workspaceConfigs.get, {
        teamSlugOrId: query.teamSlugOrId,
        projectFullName: query.projectFullName,
      });
    } catch (error) {
      throw new HTTPException(500, {
        message: `${context} Failed to load workspace configuration from Convex`,
        cause: error,
      });
    }

    if (!config) {
      return c.json(null);
    }

    const envVarsContent = await loadEnvVarsContent(
      config.dataVaultKey,
      context,
    );

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
      400: { description: "Invalid request" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const body = c.req.valid("json");
    const context = `[workspace-configs.post team=${body.teamSlugOrId} project=${body.projectFullName}]`;

    await verifyTeamAccess({
      req: c.req.raw,
      teamSlugOrId: body.teamSlugOrId,
    });

    const convex = getConvex({ accessToken });
    let existing;
    try {
      existing = await convex.query(api.workspaceConfigs.get, {
        teamSlugOrId: body.teamSlugOrId,
        projectFullName: body.projectFullName,
      });
    } catch (error) {
      throw new HTTPException(500, {
        message: `${context} Failed to load existing workspace configuration`,
        cause: error,
      });
    }

    let store;
    try {
      store = await stackServerAppJs.getDataVaultStore("cmux-snapshot-envs");
    } catch (error) {
      throw new HTTPException(500, {
        message: `${context} Unable to access workspace environment storage`,
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
      throw new HTTPException(500, {
        message: `${context} Failed to persist environment variables (key=${dataVaultKey})`,
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
      throw new HTTPException(500, {
        message: `${context} Failed to update workspace configuration metadata`,
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
