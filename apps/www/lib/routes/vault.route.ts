/**
 * Vault REST API Routes
 *
 * Provides REST endpoints for Obsidian vault integration:
 * - GET /api/vault/recommendations - Get recommended actions from vault
 * - GET /api/vault/notes - List vault notes with filtering
 * - POST /api/vault/dispatch - Create task from recommendation
 */

import {
  getAccessTokenFromRequest,
  getUserFromRequest,
} from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { api } from "@cmux/convex/api";
import {
  generateRecommendations,
  readVaultGitHub,
  readVaultLocal,
  searchNotes,
  filterNotesByPath,
  extractAllTags,
  type ObsidianNote,
} from "@cmux/shared/node/obsidian-reader";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

// ============================================================================
// Schemas
// ============================================================================

const RecommendedActionSchema = z
  .object({
    type: z.enum(["todo", "stale_note", "missing_docs", "broken_link"]).openapi({
      description: "Type of recommended action",
    }),
    source: z.string().openapi({ description: "Source note path" }),
    description: z.string().openapi({ description: "Action description" }),
    priority: z.enum(["high", "medium", "low"]).openapi({ description: "Priority level" }),
    suggestedPrompt: z.string().optional().openapi({ description: "Suggested prompt for agent" }),
  })
  .openapi("RecommendedAction");

const ObsidianNoteSchema = z
  .object({
    path: z.string().openapi({ description: "Note path relative to vault" }),
    title: z.string().openapi({ description: "Note title" }),
    modifiedAt: z.string().openapi({ description: "Last modified timestamp (ISO)" }),
    status: z.enum(["active", "archive", "stale"]).optional().openapi({ description: "Note status" }),
    todoCount: z.number().openapi({ description: "Number of incomplete TODOs" }),
    tags: z.array(z.string()).openapi({ description: "Note tags" }),
  })
  .openapi("ObsidianNote");

// Schema for vault configuration (used for documentation/validation)
const _VaultConfigSchema = z
  .object({
    type: z.enum(["local", "github"]).openapi({ description: "Vault source type" }),
    localPath: z.string().optional().openapi({ description: "Local vault path (for local type)" }),
    githubOwner: z.string().optional().openapi({ description: "GitHub owner (for github type)" }),
    githubRepo: z.string().optional().openapi({ description: "GitHub repo (for github type)" }),
    githubPath: z.string().optional().openapi({ description: "Path within repo (for github type)" }),
    githubBranch: z.string().optional().openapi({ description: "Branch name (for github type)" }),
  })
  .openapi("VaultConfig");

const DispatchRequestSchema = z
  .object({
    teamSlugOrId: z.string().openapi({ description: "Team slug or ID" }),
    recommendation: RecommendedActionSchema,
    agentName: z.string().optional().openapi({ description: "Agent to use (default: claude/sonnet-4.5)" }),
    repoFullName: z.string().optional().openapi({ description: "Repository full name" }),
  })
  .openapi("DispatchRequest");

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get vault config from user settings or environment.
 */
async function getVaultConfig(
  _teamSlugOrId: string,
  _accessToken: string
): Promise<{
  type: "local" | "github";
  localPath?: string;
  githubOwner?: string;
  githubRepo?: string;
  githubPath?: string;
  githubBranch?: string;
  githubToken?: string;
} | null> {
  // First, check environment variables for default config
  const localPath = process.env.OBSIDIAN_VAULT_PATH;
  if (localPath) {
    return { type: "local", localPath };
  }

  const githubOwner = process.env.OBSIDIAN_GITHUB_OWNER;
  const githubRepo = process.env.OBSIDIAN_GITHUB_REPO;
  const githubPath = process.env.OBSIDIAN_GITHUB_PATH;
  const githubToken = process.env.OBSIDIAN_GITHUB_TOKEN;

  if (githubOwner && githubRepo) {
    return {
      type: "github",
      githubOwner,
      githubRepo,
      githubPath: githubPath || "",
      githubBranch: process.env.OBSIDIAN_GITHUB_BRANCH || "main",
      githubToken,
    };
  }

  // TODO: Fetch user-specific vault config from workspace settings
  // For now, return null if no env config
  return null;
}

/**
 * Read notes from vault based on config.
 */
async function readVault(config: Awaited<ReturnType<typeof getVaultConfig>>): Promise<ObsidianNote[]> {
  if (!config) {
    return [];
  }

  if (config.type === "local" && config.localPath) {
    return readVaultLocal(config.localPath);
  }

  if (config.type === "github" && config.githubOwner && config.githubRepo && config.githubToken) {
    return readVaultGitHub({
      owner: config.githubOwner,
      repo: config.githubRepo,
      path: config.githubPath || "",
      token: config.githubToken,
      branch: config.githubBranch,
    });
  }

  return [];
}

// ============================================================================
// Router
// ============================================================================

export const vaultRouter = new OpenAPIHono();

/**
 * GET /api/vault/recommendations
 * Get recommended actions from Obsidian vault.
 */
vaultRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/vault/recommendations",
    tags: ["Vault"],
    summary: "Get vault recommendations",
    description: "Get recommended actions extracted from Obsidian vault notes.",
    request: {
      query: z.object({
        teamSlugOrId: z.string().openapi({ description: "Team slug or ID" }),
        limit: z.coerce.number().optional().openapi({ description: "Maximum recommendations" }),
        priority: z.enum(["high", "medium", "low"]).optional().openapi({ description: "Filter by priority" }),
        type: z.enum(["todo", "stale_note", "missing_docs", "broken_link"]).optional().openapi({
          description: "Filter by type",
        }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              recommendations: z.array(RecommendedActionSchema),
              vaultConfigured: z.boolean(),
            }),
          },
        },
        description: "Recommendations retrieved successfully",
      },
      401: { description: "Unauthorized" },
      500: { description: "Server error" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const { teamSlugOrId, limit = 50, priority, type } = c.req.valid("query");

    try {
      await verifyTeamAccess({ req: c.req.raw, teamSlugOrId });

      const config = await getVaultConfig(teamSlugOrId, accessToken);
      if (!config) {
        return c.json({ recommendations: [], vaultConfigured: false });
      }

      const notes = await readVault(config);
      let recommendations = generateRecommendations(notes);

      // Apply filters
      if (priority) {
        recommendations = recommendations.filter((r) => r.priority === priority);
      }
      if (type) {
        recommendations = recommendations.filter((r) => r.type === type);
      }

      // Apply limit
      recommendations = recommendations.slice(0, limit);

      return c.json({ recommendations, vaultConfigured: true });
    } catch (error) {
      console.error("[vault] Failed to get recommendations:", error);
      return c.text("Failed to get recommendations", 500);
    }
  }
);

/**
 * GET /api/vault/notes
 * List vault notes with filtering.
 */
vaultRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/vault/notes",
    tags: ["Vault"],
    summary: "List vault notes",
    description: "List Obsidian vault notes with optional filtering.",
    request: {
      query: z.object({
        teamSlugOrId: z.string().openapi({ description: "Team slug or ID" }),
        search: z.string().optional().openapi({ description: "Search query" }),
        folder: z.string().optional().openapi({ description: "Filter by folder path" }),
        status: z.enum(["active", "archive", "stale"]).optional().openapi({ description: "Filter by status" }),
        limit: z.coerce.number().optional().openapi({ description: "Maximum notes to return" }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              notes: z.array(ObsidianNoteSchema),
              tags: z.array(z.string()),
              vaultConfigured: z.boolean(),
            }),
          },
        },
        description: "Notes retrieved successfully",
      },
      401: { description: "Unauthorized" },
      500: { description: "Server error" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const { teamSlugOrId, search, folder, status, limit = 100 } = c.req.valid("query");

    try {
      await verifyTeamAccess({ req: c.req.raw, teamSlugOrId });

      const config = await getVaultConfig(teamSlugOrId, accessToken);
      if (!config) {
        return c.json({ notes: [], tags: [], vaultConfigured: false });
      }

      let notes = await readVault(config);

      // Apply filters
      if (search) {
        notes = searchNotes(notes, search);
      }
      if (folder) {
        notes = filterNotesByPath(notes, folder);
      }
      if (status) {
        notes = notes.filter((n) => n.status === status);
      }

      // Get all tags
      const tags = extractAllTags(notes);

      // Apply limit and transform
      const limitedNotes = notes.slice(0, limit).map((note) => ({
        path: note.path,
        title: note.title,
        modifiedAt: note.modifiedAt.toISOString(),
        status: note.status,
        todoCount: note.todos.filter((t) => !t.completed).length,
        tags: (note.frontmatter.tags as string[]) || [],
      }));

      return c.json({ notes: limitedNotes, tags, vaultConfigured: true });
    } catch (error) {
      console.error("[vault] Failed to list notes:", error);
      return c.text("Failed to list notes", 500);
    }
  }
);

/**
 * POST /api/vault/dispatch
 * Create a task from a vault recommendation.
 */
vaultRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/vault/dispatch",
    tags: ["Vault"],
    summary: "Dispatch recommendation to agent",
    description: "Create a task from a vault recommendation and dispatch it to an agent.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: DispatchRequestSchema,
          },
        },
        required: true,
      },
    },
    responses: {
      201: {
        content: {
          "application/json": {
            schema: z.object({
              taskId: z.string().openapi({ description: "Created task ID" }),
              taskRunId: z.string().optional().openapi({ description: "Created task run ID" }),
            }),
          },
        },
        description: "Task created successfully",
      },
      401: { description: "Unauthorized" },
      422: { description: "Validation error" },
      500: { description: "Server error" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const user = await getUserFromRequest(c.req.raw);
    if (!user) {
      return c.text("Unauthorized", 401);
    }

    const body = c.req.valid("json");

    try {
      await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: body.teamSlugOrId });
      const convex = getConvex({ accessToken });

      // Build task description from recommendation
      const taskDescription = body.recommendation.suggestedPrompt ||
        `[${body.recommendation.type}] ${body.recommendation.description}\n\nSource: ${body.recommendation.source}`;

      // Create the task
      const taskId = await convex.mutation(api.tasks.create, {
        text: taskDescription,
        projectFullName: body.repoFullName,
        teamSlugOrId: body.teamSlugOrId,
      });

      return c.json({ taskId }, 201);
    } catch (error) {
      console.error("[vault] Failed to dispatch recommendation:", error);
      return c.text("Failed to dispatch recommendation", 500);
    }
  }
);
