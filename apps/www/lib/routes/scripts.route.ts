import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsRouter = new OpenAPIHono();

const __dirname = dirname(fileURLToPath(import.meta.url));

const ScriptResponseSchema = z
  .object({
    script: z.string().openapi({
      description: "The TypeScript source code of the script",
    }),
    version: z.string().openapi({
      description: "Version hash of the script for cache invalidation",
    }),
  })
  .openapi("ScriptResponse");

const ErrorSchema = z
  .object({
    error: z.string().openapi({
      example: "Script not found",
    }),
  })
  .openapi("ScriptError");

const ALLOWED_SCRIPTS = new Set(["screenshot-collector"]);

// Cache for script content to avoid repeated file reads
const scriptCache = new Map<string, { content: string; mtime: number }>();

async function getScriptContent(
  scriptName: string,
): Promise<{ content: string; hash: string } | null> {
  if (!ALLOWED_SCRIPTS.has(scriptName)) {
    return null;
  }

  // Resolve path relative to this file's location
  const scriptPath = join(__dirname, "../scripts", `${scriptName}.ts`);

  try {
    const stat = await fs.stat(scriptPath);
    const cached = scriptCache.get(scriptName);

    // Return cached version if file hasn't changed
    if (cached && cached.mtime === stat.mtimeMs) {
      const hash = crypto.subtle
        ? await computeHash(cached.content)
        : stat.mtimeMs.toString(36);
      return { content: cached.content, hash };
    }

    const content = await fs.readFile(scriptPath, "utf-8");

    // Update cache
    scriptCache.set(scriptName, { content, mtime: stat.mtimeMs });

    const hash = crypto.subtle
      ? await computeHash(content)
      : stat.mtimeMs.toString(36);

    return { content, hash };
  } catch (error) {
    console.error(
      `Failed to read script ${scriptName}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function computeHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

scriptsRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/scripts/{scriptName}",
    tags: ["Scripts"],
    summary: "Get a script by name",
    description:
      "Fetches a TypeScript script that can be executed remotely by workers",
    request: {
      params: z.object({
        scriptName: z.string().openapi({
          description: "Name of the script to fetch",
          example: "screenshot-collector",
        }),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: ScriptResponseSchema,
          },
        },
        description: "Script fetched successfully",
      },
      404: {
        content: {
          "application/json": {
            schema: ErrorSchema,
          },
        },
        description: "Script not found",
      },
    },
  }),
  async (c) => {
    const { scriptName } = c.req.valid("param");

    const result = await getScriptContent(scriptName);

    if (!result) {
      return c.json({ error: "Script not found" }, 404);
    }

    return c.json(
      {
        script: result.content,
        version: result.hash,
      },
      200,
    );
  },
);

// Raw script endpoint that returns the TypeScript source directly
scriptsRouter.get("/scripts/{scriptName}/raw", async (c) => {
  const scriptName = c.req.param("scriptName");

  if (!scriptName || !ALLOWED_SCRIPTS.has(scriptName)) {
    return c.text("Script not found", 404);
  }

  const result = await getScriptContent(scriptName);

  if (!result) {
    return c.text("Script not found", 404);
  }

  c.header("Content-Type", "text/typescript; charset=utf-8");
  c.header("X-Script-Version", result.hash);
  return c.text(result.content);
});

export { scriptsRouter };
