import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { api } from "@cmux/convex/api";
import { parseLocalRepoPath } from "@cmux/shared/node";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { getConvex } from "../utils/get-convex";

const execFileAsync = promisify(execFile);

export const localReposRouter = new OpenAPIHono();

const ValidatePathRequest = z
  .object({
    path: z.string().min(1),
  })
  .openapi("ValidateLocalRepoPathRequest");

const ValidatePathResponse = z
  .object({
    isValid: z.boolean(),
    resolvedPath: z.string().optional(),
    isGitRepo: z.boolean().optional(),
    defaultBranch: z.string().optional(),
    error: z.string().optional(),
  })
  .openapi("ValidateLocalRepoPathResponse");

const AddLocalRepoRequest = z
  .object({
    team: z.string().min(1),
    path: z.string().min(1),
  })
  .openapi("AddLocalRepoRequest");

const AddLocalRepoResponse = z
  .object({
    success: z.boolean(),
    repoId: z.string().optional(),
    fullName: z.string().optional(),
    archiveUrl: z.string().optional(),
    error: z.string().optional(),
  })
  .openapi("AddLocalRepoResponse");

const DirectorySuggestion = z
  .object({
    path: z.string(),
    name: z.string(),
    isDirectory: z.boolean(),
  })
  .openapi("DirectorySuggestion");

const SuggestPathsRequest = z
  .object({
    path: z.string(),
  })
  .openapi("SuggestPathsRequest");

const SuggestPathsResponse = z
  .object({
    suggestions: z.array(DirectorySuggestion),
  })
  .openapi("SuggestPathsResponse");

// Validate a local repository path
localReposRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/repos/local/validate",
    tags: ["Local Repos"],
    summary: "Validate a local repository path",
    request: {
      body: {
        content: {
          "application/json": {
            schema: ValidatePathRequest,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Validation result",
        content: {
          "application/json": {
            schema: ValidatePathResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
      400: { description: "Bad request" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.json({ isValid: false, error: "Unauthorized" } as z.infer<typeof ValidatePathResponse>, 401);

    const { path } = c.req.valid("json");

    // Parse the path
    const parsed = parseLocalRepoPath(path);
    if (!parsed) {
      return c.json({ isValid: false, error: "Invalid path format" } as z.infer<typeof ValidatePathResponse>);
    }

    try {
      // Check if path exists
      await access(parsed.resolvedPath, constants.R_OK);

      // Check if it's a directory
      const stats = await stat(parsed.resolvedPath);
      if (!stats.isDirectory()) {
        return c.json({ isValid: false, error: "Path is not a directory" } as z.infer<typeof ValidatePathResponse>);
      }

      // Check if it's a git repository
      try {
        const { stdout: branch } = await execFileAsync("git", ["-C", parsed.resolvedPath, "rev-parse", "--abbrev-ref", "HEAD"]);
        const defaultBranch = branch.trim();

        return c.json({
          isValid: true,
          resolvedPath: parsed.resolvedPath,
          isGitRepo: true,
          defaultBranch,
        } as z.infer<typeof ValidatePathResponse>);
      } catch {
        return c.json({
          isValid: false,
          resolvedPath: parsed.resolvedPath,
          error: "Not a git repository",
        } as z.infer<typeof ValidatePathResponse>);
      }
    } catch (error) {
      return c.json({
        isValid: false,
        error: error instanceof Error ? error.message : "Path does not exist or is not accessible",
      } as z.infer<typeof ValidatePathResponse>);
    }
  }
);

// Add a local repository (creates git archive and stores in Convex)
localReposRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/repos/local",
    tags: ["Local Repos"],
    summary: "Add a local repository",
    request: {
      body: {
        content: {
          "application/json": {
            schema: AddLocalRepoRequest,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Repository added successfully",
        content: {
          "application/json": {
            schema: AddLocalRepoResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
      400: { description: "Bad request" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.json({ success: false, error: "Unauthorized" } as z.infer<typeof AddLocalRepoResponse>, 401);

    const { team, path } = c.req.valid("json");

    // Parse and validate the path
    const parsed = parseLocalRepoPath(path);
    if (!parsed) {
      return c.json({ success: false, error: "Invalid path format" } as z.infer<typeof AddLocalRepoResponse>, 400);
    }

    try {
      // Check if path exists and is a git repo
      await access(parsed.resolvedPath, constants.R_OK);
      const stats = await stat(parsed.resolvedPath);
      if (!stats.isDirectory()) {
        return c.json({ success: false, error: "Path is not a directory" } as z.infer<typeof AddLocalRepoResponse>, 400);
      }

      // Verify it's a git repository
      try {
        await execFileAsync("git", ["-C", parsed.resolvedPath, "rev-parse", "--abbrev-ref", "HEAD"]);
      } catch {
        return c.json({ success: false, error: "Not a git repository" } as z.infer<typeof AddLocalRepoResponse>, 400);
      }

      // Create git archive (tar.gz format)
      const { stdout: archiveBuffer } = await execFileAsync(
        "git",
        ["-C", parsed.resolvedPath, "archive", "--format=tar.gz", "HEAD"],
        { encoding: "buffer", maxBuffer: 100 * 1024 * 1024 } // 100MB max
      );

      // Upload archive to Convex storage
      const convex = getConvex({ accessToken });

      // Generate upload URL
      const uploadUrl = await convex.mutation(api.storage.generateUploadUrl, {
        teamSlugOrId: team,
      });

      // Upload the archive
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/gzip" },
        body: archiveBuffer,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload archive to storage");
      }

      const { storageId } = await uploadResponse.json() as { storageId: string };

      // Add the local repo via Convex action
      const result = await convex.action(api.github_http.addLocalRepo, {
        teamSlugOrId: team,
        repoPath: path,
        archiveStorageId: storageId,
      });

      return c.json({
        success: true,
        repoId: result.repoId,
        fullName: result.fullName,
      } as z.infer<typeof AddLocalRepoResponse>);
    } catch (error) {
      console.error("Failed to add local repo:", error);
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to add repository",
      } as z.infer<typeof AddLocalRepoResponse>, 400);
    }
  }
);

// Get directory suggestions for autocomplete
localReposRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/repos/local/suggest",
    tags: ["Local Repos"],
    summary: "Get directory suggestions for a path prefix",
    request: {
      body: {
        content: {
          "application/json": {
            schema: SuggestPathsRequest,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Directory suggestions",
        content: {
          "application/json": {
            schema: SuggestPathsResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.json({ suggestions: [] } as z.infer<typeof SuggestPathsResponse>, 401);

    const { path } = c.req.valid("json");

    // Parse the path
    const parsed = parseLocalRepoPath(path || "~");
    if (!parsed) {
      return c.json({ suggestions: [] } as z.infer<typeof SuggestPathsResponse>);
    }

    try {
      // Use bash completion-style logic: if path ends with /, list contents; otherwise list parent
      const { stdout } = await execFileAsync("bash", [
        "-c",
        `compgen -d "${parsed.resolvedPath}" | head -20`,
      ]);

      const suggestions = stdout
        .split("\n")
        .filter(Boolean)
        .map((p) => ({
          path: p,
          name: p.split("/").filter(Boolean).pop() || p,
          isDirectory: true,
        }));

      return c.json({ suggestions } as z.infer<typeof SuggestPathsResponse>);
    } catch {
      return c.json({ suggestions: [] } as z.infer<typeof SuggestPathsResponse>);
    }
  }
);
