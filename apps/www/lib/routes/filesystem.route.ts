import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { readdir, stat } from "node:fs/promises";
import { join, dirname, resolve, normalize } from "node:path";
import { homedir } from "node:os";
import { parseLocalRepoPath } from "@cmux/shared/utils/parse-local-repo-path";
import { RepositoryManager } from "@/src/repositoryManager";

const app = new OpenAPIHono();
const repoManager = RepositoryManager.getInstance();

/**
 * GET /filesystem/suggest-directories
 * Returns directory suggestions based on a partial path input.
 */
app.openapi(
  createRoute({
    method: "get",
    path: "/filesystem/suggest-directories",
    summary: "Get directory suggestions",
    description: "Returns a list of directory suggestions based on a partial path. Supports ~ expansion for home directory.",
    request: {
      query: z.object({
        path: z.string().describe("Partial path to autocomplete"),
        limit: z.string().optional().default("20").openapi({
          description: "Maximum number of suggestions to return",
        }),
      }),
    },
    responses: {
      200: {
        description: "List of directory suggestions",
        content: {
          "application/json": {
            schema: z.object({
              suggestions: z.array(
                z.object({
                  path: z.string().describe("Full path of the directory"),
                  name: z.string().describe("Directory name (basename)"),
                  isGitRepo: z.boolean().describe("Whether this directory contains a .git folder"),
                })
              ),
              inputPath: z.string().describe("The normalized input path"),
            }),
          },
        },
      },
      400: {
        description: "Invalid path",
        content: {
          "application/json": {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
      500: {
        description: "Server error",
        content: {
          "application/json": {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    try {
      const { path: inputPath, limit } = c.req.valid("query");
      const maxSuggestions = Number.parseInt(limit, 10);

      if (!inputPath) {
        return c.json({ error: "Path is required" }, 400);
      }

      // Parse and normalize the path
      const parsed = parseLocalRepoPath(inputPath);
      if (!parsed) {
        return c.json({ error: "Invalid path" }, 400);
      }

      let searchPath = parsed.path;
      let searchPattern = "";

      // Determine the directory to search and the pattern to match
      try {
        const stats = await stat(searchPath);
        if (stats.isDirectory()) {
          // If it's a complete directory, search within it
          searchPattern = "";
        } else {
          // Shouldn't happen with a valid directory path
          return c.json({ error: "Path is not a directory" }, 400);
        }
      } catch {
        // Path doesn't exist, extract directory and pattern
        searchPattern = searchPath.split("/").pop() || "";
        searchPath = dirname(searchPath);
      }

      // Read the directory
      let entries: string[] = [];
      try {
        entries = await readdir(searchPath);
      } catch (error) {
        // Directory doesn't exist or can't be read
        console.error("Failed to read directory:", error);
        return c.json({ suggestions: [], inputPath: parsed.path }, 200);
      }

      // Filter and process entries
      const suggestions: Array<{
        path: string;
        name: string;
        isGitRepo: boolean;
      }> = [];

      for (const entry of entries) {
        // Skip hidden files unless the pattern starts with "."
        if (entry.startsWith(".") && !searchPattern.startsWith(".")) {
          continue;
        }

        // Filter by pattern if provided
        if (searchPattern && !entry.toLowerCase().startsWith(searchPattern.toLowerCase())) {
          continue;
        }

        const fullPath = join(searchPath, entry);

        try {
          const stats = await stat(fullPath);
          if (stats.isDirectory()) {
            // Check if it's a git repository
            let isGitRepo = false;
            try {
              const gitPath = join(fullPath, ".git");
              const gitStats = await stat(gitPath);
              isGitRepo = gitStats.isDirectory();
            } catch {
              // .git doesn't exist
              isGitRepo = false;
            }

            suggestions.push({
              path: fullPath,
              name: entry,
              isGitRepo,
            });

            if (suggestions.length >= maxSuggestions) {
              break;
            }
          }
        } catch {
          // Skip entries we can't stat
          continue;
        }
      }

      // Sort: git repos first, then alphabetically
      suggestions.sort((a, b) => {
        if (a.isGitRepo && !b.isGitRepo) return -1;
        if (!a.isGitRepo && b.isGitRepo) return 1;
        return a.name.localeCompare(b.name);
      });

      return c.json({
        suggestions,
        inputPath: parsed.path,
      });
    } catch (error) {
      console.error("Error in suggest-directories:", error);
      return c.json(
        {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  }
);

/**
 * POST /filesystem/archive-local-repo
 * Creates a git archive from a local repository path
 */
app.openapi(
  createRoute({
    method: "post",
    path: "/filesystem/archive-local-repo",
    summary: "Archive a local repository",
    description: "Creates a git archive (.tar.gz) from a local repository path. Supports ~ expansion.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              repoPath: z.string().describe("Absolute or ~ path to the local git repository"),
              branch: z.string().optional().describe("Optional branch name to archive (defaults to current branch)"),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Archive created successfully",
        content: {
          "application/json": {
            schema: z.object({
              archivePath: z.string().describe("Path to the created archive file"),
              repoName: z.string().describe("Name of the repository"),
              branch: z.string().describe("Branch that was archived"),
              commitHash: z.string().describe("Commit hash of the archived state"),
            }),
          },
        },
      },
      400: {
        description: "Invalid path or not a git repository",
        content: {
          "application/json": {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
      500: {
        description: "Server error",
        content: {
          "application/json": {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    try {
      const { repoPath, branch } = c.req.valid("json");

      // Parse and normalize the path
      const parsed = parseLocalRepoPath(repoPath);
      if (!parsed) {
        return c.json({ error: "Invalid repository path" }, 400);
      }

      // Check if path exists and is a directory
      try {
        const stats = await stat(parsed.path);
        if (!stats.isDirectory()) {
          return c.json({ error: "Path is not a directory" }, 400);
        }
      } catch {
        return c.json({ error: "Repository path does not exist" }, 400);
      }

      // Create the archive using RepositoryManager
      const result = await repoManager.archiveLocalRepo(parsed.path, branch);

      return c.json(result);
    } catch (error) {
      console.error("Error archiving local repository:", error);
      return c.json(
        {
          error: error instanceof Error ? error.message : "Failed to archive repository",
        },
        500
      );
    }
  }
);

export const filesystemRouter = app;
