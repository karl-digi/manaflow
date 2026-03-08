import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { api } from "@cmux/convex/api";
import { MCP_SERVER_PRESETS } from "@cmux/shared";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Id } from "@cmux/convex/dataModel";

export const mcpServersRouter = new OpenAPIHono();

const ScopeSchema = z.enum(["global", "workspace"]).openapi("McpServerScope");
const HeaderRecordSchema = z.record(z.string(), z.string());

const SupportedAgentsSchema = z
  .object({
    claude: z.boolean(),
    codex: z.boolean(),
    gemini: z.boolean(),
    opencode: z.boolean(),
  })
  .openapi("McpServerPresetSupportedAgents");

const McpServerPresetSchema = z
  .object({
    name: z.string(),
    displayName: z.string(),
    description: z.string(),
    type: z.literal("stdio"),
    command: z.string(),
    args: z.array(z.string()),
    tags: z.array(z.string()),
    supportedAgents: SupportedAgentsSchema,
  })
  .openapi("McpServerPreset");

const McpServerBaseSchema = z.object({
  _id: z.string(),
  name: z.string(),
  displayName: z.string(),
  hasEnvVars: z.boolean().optional(),
  envVarKeys: z.array(z.string()).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  enabledClaude: z.boolean(),
  enabledCodex: z.boolean(),
  enabledGemini: z.boolean(),
  enabledOpencode: z.boolean(),
  scope: ScopeSchema,
  projectFullName: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const McpServerStdioSchema = McpServerBaseSchema.extend({
  type: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()),
})
  .openapi("McpServerStdioConfig");

const McpServerRemoteFieldsSchema = {
  url: z.string(),
  headers: HeaderRecordSchema.optional(),
};

const McpServerHttpSchema = McpServerBaseSchema.extend({
  type: z.literal("http"),
  ...McpServerRemoteFieldsSchema,
})
  .openapi("McpServerHttpConfig");

const McpServerSseSchema = McpServerBaseSchema.extend({
  type: z.literal("sse"),
  ...McpServerRemoteFieldsSchema,
})
  .openapi("McpServerSseConfig");

const McpServerConfigSchema = z
  .discriminatedUnion("type", [McpServerStdioSchema, McpServerHttpSchema, McpServerSseSchema])
  .openapi("McpServerConfig");

const McpServersListResponse = z
  .object({
    configs: z.array(McpServerConfigSchema),
    presets: z.array(McpServerPresetSchema),
  })
  .openapi("McpServersListResponse");

const McpServerListQuery = z
  .object({
    teamSlugOrId: z.string(),
    scope: ScopeSchema.optional(),
    projectFullName: z.string().optional(),
  })
  .openapi("McpServerListQuery");

const UpsertMcpServerStdioBody = z.object({
  name: z.string(),
  displayName: z.string(),
  type: z.literal("stdio").default("stdio"),
  command: z.string(),
  args: z.array(z.string()).default([]),
  envVars: HeaderRecordSchema.optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  enabledClaude: z.boolean(),
  enabledCodex: z.boolean(),
  enabledGemini: z.boolean(),
  enabledOpencode: z.boolean(),
  scope: ScopeSchema,
  projectFullName: z.string().optional(),
});

const UpsertMcpServerRemoteFieldsSchema = {
  name: z.string(),
  displayName: z.string(),
  url: z.string(),
  headers: HeaderRecordSchema.optional(),
  envVars: HeaderRecordSchema.optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  enabledClaude: z.boolean(),
  enabledCodex: z.boolean(),
  enabledGemini: z.boolean(),
  enabledOpencode: z.boolean(),
  scope: ScopeSchema,
  projectFullName: z.string().optional(),
};

const UpsertMcpServerHttpBody = z.object({
  type: z.literal("http"),
  ...UpsertMcpServerRemoteFieldsSchema,
});

const UpsertMcpServerSseBody = z.object({
  type: z.literal("sse"),
  ...UpsertMcpServerRemoteFieldsSchema,
});

const UpsertMcpServerBody = z
  .union([
    UpsertMcpServerStdioBody,
    UpsertMcpServerHttpBody,
    UpsertMcpServerSseBody,
  ])
  .openapi("UpsertMcpServerBody");

const SuccessResponse = z
  .object({
    success: z.boolean(),
    id: z.string().optional(),
  })
  .openapi("McpServerSuccessResponse");

mcpServersRouter.openapi(
  createRoute({
    method: "get",
    path: "/mcp-servers",
    tags: ["McpServers"],
    summary: "List MCP server configurations and presets",
    request: {
      query: McpServerListQuery,
    },
    responses: {
      200: {
        description: "List of MCP server configs and presets",
        content: {
          "application/json": {
            schema: McpServersListResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const query = c.req.valid("query");
    await verifyTeamAccess({
      accessToken,
      teamSlugOrId: query.teamSlugOrId,
    });

    const convex = getConvex({ accessToken });
    const configs = await convex.query(api.mcpServerConfigs.list, {
      teamSlugOrId: query.teamSlugOrId,
      ...(query.scope ? { scope: query.scope } : {}),
      ...(query.projectFullName ? { projectFullName: query.projectFullName } : {}),
    });

    return c.json({
      configs: configs.map((config) => {
        const envVarKeys = config.envVars ? Object.keys(config.envVars) : [];
        const commonFields = {
          _id: config._id,
          name: config.name,
          displayName: config.displayName,
          hasEnvVars: envVarKeys.length > 0,
          envVarKeys,
          description: config.description,
          tags: config.tags,
          enabledClaude: config.enabledClaude,
          enabledCodex: config.enabledCodex,
          enabledGemini: config.enabledGemini,
          enabledOpencode: config.enabledOpencode,
          scope: config.scope,
          projectFullName: config.projectFullName,
          createdAt: config.createdAt,
          updatedAt: config.updatedAt,
        };

        if (config.type === "http" || config.type === "sse") {
          return {
            ...commonFields,
            type: config.type,
            url: config.url,
            headers: config.headers,
          };
        }

        return {
          ...commonFields,
          type: "stdio" as const,
          command: config.command,
          args: config.args ?? [],
        };
      }),
      presets: MCP_SERVER_PRESETS,
    });
  },
);

mcpServersRouter.openapi(
  createRoute({
    method: "post",
    path: "/mcp-servers",
    tags: ["McpServers"],
    summary: "Create or update an MCP server configuration",
    request: {
      query: z.object({
        teamSlugOrId: z.string(),
      }),
      body: {
        content: {
          "application/json": {
            schema: UpsertMcpServerBody,
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
            schema: SuccessResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const query = c.req.valid("query");
    const body = c.req.valid("json");

    await verifyTeamAccess({
      accessToken,
      teamSlugOrId: query.teamSlugOrId,
    });

    const convex = getConvex({ accessToken });
    const id = await convex.mutation(api.mcpServerConfigs.upsert, {
      teamSlugOrId: query.teamSlugOrId,
      name: body.name,
      displayName: body.displayName,
      type: body.type,
      ...(body.type === "stdio"
        ? {
            command: body.command,
            args: body.args,
          }
        : {
            url: body.url,
            ...(body.headers !== undefined ? { headers: body.headers } : {}),
          }),
      ...(body.envVars !== undefined ? { envVars: body.envVars } : {}),
      description: body.description,
      tags: body.tags,
      enabledClaude: body.enabledClaude,
      enabledCodex: body.enabledCodex,
      enabledGemini: body.enabledGemini,
      enabledOpencode: body.enabledOpencode,
      scope: body.scope,
      projectFullName: body.projectFullName,
    });

    return c.json({ success: true, id });
  },
);

mcpServersRouter.openapi(
  createRoute({
    method: "delete",
    path: "/mcp-servers/{id}",
    tags: ["McpServers"],
    summary: "Delete an MCP server configuration",
    request: {
      params: z.object({
        id: z.string().describe("MCP server config document ID"),
      }),
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Configuration deleted",
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
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const { id } = c.req.valid("param");
    const query = c.req.valid("query");

    await verifyTeamAccess({
      accessToken,
      teamSlugOrId: query.teamSlugOrId,
    });

    const convex = getConvex({ accessToken });
    await convex.mutation(api.mcpServerConfigs.remove, {
      teamSlugOrId: query.teamSlugOrId,
      id: id as Id<"mcpServerConfigs">,
    });

    return c.json({ success: true });
  },
);
