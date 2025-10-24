import { getConvex } from "@/lib/utils/get-convex";
import { stackServerApp } from "@/lib/utils/stack";
import { api } from "@cmux/convex/api";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const workspaceSettingsRouter = new OpenAPIHono();

const WorkspaceSettingsSchema = z
  .object({
    worktreePath: z.string().optional(),
    autoPrEnabled: z.boolean().optional(),
    themeSyncEnabled: z.boolean().optional(),
    preferredTheme: z.enum(["light", "dark", "system"]).optional(),
    preferredColorTheme: z.string().optional(),
  })
  .openapi("WorkspaceSettings");

const WorkspaceSettingsResponseSchema = z
  .object({
    worktreePath: z.string().optional(),
    autoPrEnabled: z.boolean().optional(),
    themeSyncEnabled: z.boolean().optional(),
    preferredTheme: z.enum(["light", "dark", "system"]).optional(),
    preferredColorTheme: z.string().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .openapi("WorkspaceSettingsResponse");

const ErrorResponseSchema = z
  .object({
    code: z.number(),
    message: z.string(),
  })
  .openapi("ErrorResponse");

// Get workspace settings
workspaceSettingsRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/workspace-settings",
    tags: ["Workspace Settings"],
    summary: "Get workspace settings for a team",
    request: {
      query: z.object({
        teamSlugOrId: z.string().openapi({
          description: "Team slug or ID",
          example: "my-team",
        }),
      }),
    },
    responses: {
      200: {
        description: "Workspace settings",
        content: {
          "application/json": {
            schema: WorkspaceSettingsResponseSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      404: {
        description: "Team not found",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  }),
  async (c) => {
    const { teamSlugOrId } = c.req.valid("query");

    const user = await stackServerApp.getUser({ tokenStore: c.req.raw, or: "return-null" });
    if (!user) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const authJson = await user.getAuthJson();
    if (!authJson.accessToken) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const convex = getConvex({ accessToken: authJson.accessToken });

    try {
      const settings = await convex.query(api.workspaceSettings.get, { teamSlugOrId });
      
      if (!settings) {
        // Return default settings if none exist
        return c.json({
          worktreePath: undefined,
          autoPrEnabled: false,
          themeSyncEnabled: false,
          preferredTheme: "system",
          preferredColorTheme: undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }, 200);
      }

      return c.json(settings, 200);
    } catch (error) {
      console.error("Failed to get workspace settings:", error);
      return c.json({ code: 500, message: "Failed to get workspace settings" }, 500);
    }
  }
);

// Update workspace settings
workspaceSettingsRouter.openapi(
  createRoute({
    method: "patch" as const,
    path: "/workspace-settings",
    tags: ["Workspace Settings"],
    summary: "Update workspace settings for a team",
    request: {
      query: z.object({
        teamSlugOrId: z.string().openapi({
          description: "Team slug or ID",
          example: "my-team",
        }),
      }),
      body: {
        content: {
          "application/json": {
            schema: WorkspaceSettingsSchema,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Workspace settings updated",
        content: {
          "application/json": {
            schema: WorkspaceSettingsResponseSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      404: {
        description: "Team not found",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
      422: {
        description: "Validation error",
        content: {
          "application/json": {
            schema: ErrorResponseSchema,
          },
        },
      },
    },
  }),
  async (c) => {
    const { teamSlugOrId } = c.req.valid("query");
    const body = c.req.valid("json");

    const user = await stackServerApp.getUser({ tokenStore: c.req.raw, or: "return-null" });
    if (!user) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const authJson = await user.getAuthJson();
    if (!authJson.accessToken) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const convex = getConvex({ accessToken: authJson.accessToken });

    try {
      await convex.mutation(api.workspaceSettings.update, {
        teamSlugOrId,
        ...body,
      });

      // Fetch the updated settings
      const updatedSettings = await convex.query(api.workspaceSettings.get, { teamSlugOrId });
      
      if (!updatedSettings) {
        return c.json({ code: 404, message: "Settings not found after update" }, 404);
      }

      return c.json(updatedSettings, 200);
    } catch (error) {
      console.error("Failed to update workspace settings:", error);
      return c.json({ code: 500, message: "Failed to update workspace settings" }, 500);
    }
  }
);

export { workspaceSettingsRouter };