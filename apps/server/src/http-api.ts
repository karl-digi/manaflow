/**
 * HTTP API endpoints for apps/server
 *
 * Option C: Expose agent spawning via HTTP API so CLI can use the same
 * code path as the web app's socket.io "start-task" event.
 *
 * This enables CLI to create tasks with proper agent spawning,
 * identical to the web app flow.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { AGENT_CONFIGS } from "@cmux/shared/agentConfig";
import { spawnAllAgents } from "./agentSpawner";
import {
  DEFAULT_BRANCH_PREFIX,
  generateBranchNamesFromDescription,
  generatePRInfoAndBranchNames,
} from "./utils/branchNameGenerator";
import { getConvex } from "./utils/convexClient";
import { serverLogger } from "./utils/fileLogger";
import { runWithAuth } from "./utils/requestContext";

interface StartTaskRequest {
  // Required fields
  taskId: string;
  taskDescription: string;
  projectFullName: string;
  // Optional fields
  repoUrl?: string;
  branch?: string;
  taskRunIds?: string[];
  selectedAgents?: string[];
  isCloudMode?: boolean;
  environmentId?: string;
  theme?: "dark" | "light" | "system";
  prTitle?: string;
  images?: Array<
    | {
        // Inline image data (same shape as StartTaskSchema over socket.io)
        src: string;
        fileName?: string;
        altText: string;
      }
    | {
        // Storage-backed image reference (Convex _storage ID)
        imageId: string;
        fileName?: string;
        altText?: string;
      }
  >;
}

interface StartTaskResponse {
  taskId: string;
  results: Array<{
    agentName: string;
    taskRunId: string;
    vscodeUrl?: string;
    success: boolean;
    error?: string;
  }>;
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseAuthHeader(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => {
      resolve(null);
    });
  });
}

/**
 * Handle POST /api/start-task
 *
 * This is the HTTP equivalent of the socket.io "start-task" event.
 * CLI can call this endpoint to spawn agents with the same flow as web app.
 */
async function handleStartTask(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Extract auth token
  const authToken = parseAuthHeader(req);
  if (!authToken) {
    jsonResponse(res, 401, { error: "Unauthorized: Missing Bearer token" });
    return;
  }

  // Construct authHeaderJson from token (same format as Stack Auth x-stack-auth header)
  // This is needed for getWwwClient() to make authenticated requests to www API
  const authHeaderJson = JSON.stringify({ accessToken: authToken });

  // Parse request body
  const body = await readJsonBody<StartTaskRequest & { teamSlugOrId: string }>(req);
  if (!body) {
    jsonResponse(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const {
    taskId,
    taskDescription,
    projectFullName,
    repoUrl,
    branch,
    taskRunIds,
    selectedAgents,
    isCloudMode = true, // Default to cloud mode for CLI
    environmentId,
    theme,
    teamSlugOrId,
    prTitle,
    images,
  } = body;

  if (!taskId || !taskDescription || !projectFullName) {
    jsonResponse(res, 400, {
      error: "Missing required fields: taskId, taskDescription, projectFullName",
    });
    return;
  }

  if (!teamSlugOrId) {
    jsonResponse(res, 400, { error: "Missing required field: teamSlugOrId" });
    return;
  }

  serverLogger.info("[http-api] POST /api/start-task", {
    taskId,
    projectFullName,
    selectedAgents,
    isCloudMode,
  });

  try {
    // Run with auth context (both token and authHeaderJson needed for www API calls)
    const results = await runWithAuth(authToken, authHeaderJson, async () => {
      // Determine which agents to spawn
      // Default to claude/opus-4.5 if no agent specified (matches CLI default)
      const agentsToSpawn = selectedAgents || ["claude/opus-4.5"];
      const agentCount = agentsToSpawn.length;

      // Fetch workspace settings for branchPrefix (same as socket.io handler)
      const workspaceSettings = await getConvex().query(
        api.workspaceSettings.get,
        { teamSlugOrId }
      );
      // Use configured prefix, or default if not set (undefined/null)
      // Empty string is valid and means no prefix
      const branchPrefix =
        workspaceSettings?.branchPrefix !== undefined
          ? workspaceSettings.branchPrefix
          : DEFAULT_BRANCH_PREFIX;

      // Generate branch names for agents
      let branchNames: string[] | undefined;
      if (agentsToSpawn.length > 0) {
        branchNames = generateBranchNamesFromDescription(
          taskDescription,
          agentsToSpawn.length,
          branchPrefix
        );
      }

      // Save PR title when provided (so auto-PR uses it later)
      if (prTitle && prTitle.trim().length > 0) {
        await getConvex().mutation(api.tasks.setPullRequestTitle, {
          teamSlugOrId,
          id: taskId as Id<"tasks">,
          pullRequestTitle: prTitle,
        });
      }

      // Fire-and-forget: generate AI PR title asynchronously (non-blocking)
      // Mirrors the socket.io "start-task" handler behavior.
      if (!prTitle || prTitle.trim().length === 0) {
        void (async () => {
          try {
            const prInfo = await generatePRInfoAndBranchNames(
              taskDescription,
              agentCount,
              teamSlugOrId
            );
            await getConvex().mutation(api.tasks.setPullRequestTitle, {
              teamSlugOrId,
              id: taskId as Id<"tasks">,
              pullRequestTitle: prInfo.prTitle,
            });
            serverLogger.info(
              `[http-api] AI-generated PR title saved: "${prInfo.prTitle}"`
            );
          } catch (e) {
            serverLogger.error(
              "[http-api] Failed generating PR title (non-blocking):",
              e
            );
          }
        })();
      }

      // Normalize images: accept either inline base64 (src) or storage IDs (imageId)
      let imagesForSpawner:
        | Array<{ src: string; fileName?: string; altText: string }>
        | undefined;
      if (images && images.length > 0) {
        const inline = images.filter(
          (img): img is { src: string; fileName?: string; altText: string } =>
            "src" in img && typeof img.src === "string"
        );
        const refs = images.filter(
          (
            img
          ): img is { imageId: string; fileName?: string; altText?: string } =>
            "imageId" in img && typeof img.imageId === "string"
        );

        if (refs.length > 0) {
          const storageIds = refs.map((img) => img.imageId as Id<"_storage">);
          const urls = await getConvex().query(api.storage.getUrls, {
            teamSlugOrId,
            storageIds,
          });
          const downloaded = await Promise.all(
            refs.map(async (img, index) => {
              const url = urls.find((u) => u.storageId === img.imageId);
              if (!url) {
                return null;
              }
              const response = await fetch(url.url);
              const buffer = await response.arrayBuffer();
              const base64 = Buffer.from(buffer).toString("base64");
              const mime =
                response.headers.get("content-type") ?? "image/png";
              const fileName = img.fileName;
              const altText =
                img.altText?.trim().length
                  ? img.altText
                  : fileName || `image_${index + 1}`;
              const base = {
                src: `data:${mime};base64,${base64}`,
                altText,
              };
              return fileName ? { ...base, fileName } : base;
            })
          );

          imagesForSpawner = downloaded.filter(
            (img): img is { src: string; fileName?: string; altText: string } =>
              img !== null
          );
        }

        if (inline.length > 0) {
          imagesForSpawner = [
            ...(imagesForSpawner ?? []),
            ...inline,
          ];
        }
      }

      // Spawn all agents using the same code path as socket.io handler
      const agentResults = await spawnAllAgents(
        taskId as Id<"tasks">,
        {
          repoUrl,
          branch,
          taskDescription,
          prTitle,
          branchNames,
          selectedAgents: agentsToSpawn,
          taskRunIds: taskRunIds as Id<"taskRuns">[] | undefined,
          isCloudMode,
          environmentId: environmentId as Id<"environments"> | undefined,
          images: imagesForSpawner,
          theme,
        },
        teamSlugOrId
      );

      return agentResults.map((result) => ({
        agentName: result.agentName,
        taskRunId: result.taskRunId,
        vscodeUrl: result.vscodeUrl,
        success: result.success,
        error: result.error,
      }));
    });

    serverLogger.info("[http-api] start-task completed", {
      taskId,
      resultCount: results.length,
    });

    jsonResponse(res, 200, {
      taskId,
      results,
    } satisfies StartTaskResponse);
  } catch (error) {
    serverLogger.error("[http-api] start-task failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    jsonResponse(res, 500, { error: message });
  }
}

/**
 * HTTP request handler for apps/server
 *
 * Integrates with the existing HTTP server to add API endpoints.
 */
export function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  // CORS headers for CLI access
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Handle preflight
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  // Route: POST /api/start-task
  if (method === "POST" && path === "/api/start-task") {
    void handleStartTask(req, res);
    return true;
  }

  // Route: GET /api/health
  if (method === "GET" && path === "/api/health") {
    jsonResponse(res, 200, { status: "ok", service: "apps-server" });
    return true;
  }

  // Route: GET /api/agents - List available agents
  if (method === "GET" && path === "/api/agents") {
    const agents = AGENT_CONFIGS.filter((config) => !config.disabled).map(
      (config) => ({
        name: config.name,
        command: config.command,
      })
    );
    jsonResponse(res, 200, { agents });
    return true;
  }

  // Not handled by HTTP API
  return false;
}
