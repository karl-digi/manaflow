import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { env } from "@/lib/utils/www-env";
import { api } from "@cmux/convex/api";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

type RepoMetadata = {
  defaultBranch: string | null;
  description: string | null;
};

type SanitizedContextFile = {
  path: string;
  content: string;
  truncated: boolean;
};

const MAX_CONTEXT_FILES = 5;
const MAX_CONTEXT_CHARACTERS = 8_000;

const PlanMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().trim().min(1),
  })
  .openapi("PlanMessage");

const PlanContextFileSchema = z
  .object({
    path: z.string().trim().min(1),
    content: z.string().min(1),
  })
  .openapi("PlanContextFile");

const PlanChatRequestSchema = z
  .object({
    teamSlugOrId: z.string().trim().min(1),
    projectFullName: z
      .string()
      .trim()
      .regex(/^[^\/\s]+\/[^\/\s]+$/, "Must be in the format owner/repo"),
    branch: z.string().trim().min(1).optional(),
    messages: z.array(PlanMessageSchema).min(1),
    contextFiles: z.array(PlanContextFileSchema).max(MAX_CONTEXT_FILES).optional(),
  })
  .openapi("PlanChatRequest");

const PlanTaskSuggestionSchema = z
  .object({
    title: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
  })
  .openapi("PlanTaskSuggestion");

const PlanAssistantResponseSchema = z
  .object({
    summary: z.string().trim().min(1),
    keyPoints: z.array(z.string().trim().min(1)).default([]),
    suggestedTasks: z.array(PlanTaskSuggestionSchema).default([]),
    followUps: z.array(z.string().trim().min(1)).default([]),
    references: z
      .array(
        z.object({
          path: z.string().trim().min(1),
          description: z.string().trim().min(1).optional(),
        }),
      )
      .default([]),
  })
  .openapi("PlanAssistantResponse");

const PlanChatResponseSchema = z
  .object({
    message: z.string().trim().min(1),
    parsed: PlanAssistantResponseSchema.optional(),
  })
  .openapi("PlanChatResponse");

type PlanMessage = z.infer<typeof PlanMessageSchema>;

type PlanContextFile = z.infer<typeof PlanContextFileSchema>;

type AssistantJson = z.infer<typeof PlanAssistantResponseSchema>;

type KeyMap = Record<string, string>;

const planRouter = new OpenAPIHono();

const planChatRoute = createRoute({
  method: "post",
  path: "/plan/chat",
  summary: "Start or continue a Plan Mode conversation",
  tags: ["Plan"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: PlanChatRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Assistant response",
      content: {
        "application/json": {
          schema: PlanChatResponseSchema,
        },
      },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    404: { description: "Repository not found" },
    424: { description: "Missing OpenAI API key" },
    429: { description: "GitHub rate limited" },
    500: { description: "Unhandled error" },
  },
});

planRouter.openapi(planChatRoute, async (c) => {
  const body = c.req.valid("json");
  const accessToken = await getAccessTokenFromRequest(c.req.raw);
  if (!accessToken) {
    return c.json({ code: 401, message: "Unauthorized" }, 401);
  }

  await verifyTeamAccess({ accessToken, teamSlugOrId: body.teamSlugOrId });

  const repoMetadata = await fetchRepoMetadata(body.projectFullName);
  const branch = body.branch ?? repoMetadata.defaultBranch ?? "main";

  const convex = getConvex({ accessToken });
  const apiKeys = (await convex.query(api.apiKeys.getAllForAgents, {
    teamSlugOrId: body.teamSlugOrId,
  })) as KeyMap;

  const openaiKey = apiKeys.OPENAI_API_KEY ?? env.OPENAI_API_KEY;
  if (!openaiKey) {
    return c.json(
      {
        code: 424,
        message: "OpenAI API key is not configured for this team",
      },
      424,
    );
  }

  const sanitizedFiles = sanitizeContextFiles(body.contextFiles);

  const systemPrompt = buildSystemPrompt({
    projectFullName: body.projectFullName,
    branch,
    repoMetadata,
    sanitizedFiles,
  });

  const prompt = buildPrompt({
    messages: body.messages,
    sanitizedFiles,
  });

  const openai = createOpenAI({ apiKey: openaiKey });

  try {
    const completion = await generateText({
      model: openai("gpt-5-pro"),
      system: systemPrompt,
      prompt,
      temperature: 0.25,
      maxRetries: 2,
    });

    const message = completion.text.trim();
    const parsed = safeParseAssistantJson(message);

    return c.json({ message, parsed }, 200);
  } catch (error) {
    console.error("[plan.chat] OpenAI request failed", error);
    return c.json(
      {
        code: 500,
        message: "Failed to generate plan response",
      },
      500,
    );
  }
});

async function fetchRepoMetadata(projectFullName: string): Promise<RepoMetadata> {
  const url = `https://api.github.com/repos/${projectFullName}`;
  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "cmux-plan-mode",
      },
    });
  } catch (error) {
    console.error("[plan.chat] GitHub metadata request failed", error);
    throw new HTTPException(500, {
      message: "Unable to reach GitHub to inspect repository",
    });
  }

  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
    throw new HTTPException(429, {
      message: "GitHub rate limit exceeded. Try again later.",
    });
  }

  if (response.status === 404) {
    throw new HTTPException(404, {
      message: "Repository not found",
    });
  }

  if (!response.ok) {
    throw new HTTPException(502, {
      message: `Unexpected GitHub response (${response.status})`,
    });
  }

  const json = (await response.json()) as {
    private?: boolean;
    default_branch?: string | null;
    description?: string | null;
  };

  if (json.private) {
    throw new HTTPException(403, {
      message: "Plan Mode currently supports only public repositories.",
    });
  }

  return {
    defaultBranch: json.default_branch ?? null,
    description: json.description ?? null,
  };
}

function sanitizeContextFiles(
  files: PlanContextFile[] | undefined,
): SanitizedContextFile[] {
  if (!files || files.length === 0) {
    return [];
  }

  return files.slice(0, MAX_CONTEXT_FILES).map((file) => {
    const trimmedContent = file.content.trim();
    const truncated = trimmedContent.length > MAX_CONTEXT_CHARACTERS;
    const content = truncated
      ? `${trimmedContent.slice(0, MAX_CONTEXT_CHARACTERS)}\n\n/* truncated for length */`
      : trimmedContent;

    return {
      path: file.path,
      content,
      truncated,
    } satisfies SanitizedContextFile;
  });
}

function buildSystemPrompt({
  projectFullName,
  branch,
  repoMetadata,
  sanitizedFiles,
}: {
  projectFullName: string;
  branch: string;
  repoMetadata: RepoMetadata;
  sanitizedFiles: SanitizedContextFile[];
}): string {
  const schemaDescription = `Return JSON matching this TypeScript type exactly without extra commentary:\n\n{
  "summary": string;
  "keyPoints": string[];
  "suggestedTasks": Array<{ "title": string; "prompt": string }>;
  "followUps": string[];
  "references": Array<{ "path": string; "description"?: string }>;
}`;

  const lines = [
    "You are cmux Plan Mode, a senior staff-level engineer who helps orchestrate coding agent work.",
    "Use the provided conversation and context to outline next steps, surface key risks, and suggest actionable tasks for cmux agents.",
    `Target repository: ${projectFullName} (branch: ${branch}).`,
  ];

  if (repoMetadata.description) {
    lines.push(`Repository description: ${repoMetadata.description}`);
  }

  if (sanitizedFiles.length > 0) {
    lines.push(
      "You were given concrete file excerpts. Do not invent details beyond that context.",
    );
  }

  lines.push(
    "When referencing files, use relative paths from the repo root.",
    "Keep responses concise but complete. Suggested tasks should be directly runnable by cmux agents.",
    schemaDescription,
    "Respond with strictly valid JSON only.",
  );

  return lines.join("\n");
}

function buildPrompt({
  messages,
  sanitizedFiles,
}: {
  messages: PlanMessage[];
  sanitizedFiles: SanitizedContextFile[];
}): string {
  const sections: string[] = [];

  if (sanitizedFiles.length > 0) {
    const fileSection = sanitizedFiles
      .map((file) => {
        const header = `Path: ${file.path}${file.truncated ? " (truncated)" : ""}`;
        return `${header}\n\n\`\`\`\n${file.content}\n\`\`\``;
      })
      .join("\n\n");
    sections.push("Context files:\n" + fileSection);
  }

  const conversation = messages
    .map((message) => {
      const prefix =
        message.role === "assistant"
          ? "Assistant"
          : message.role === "system"
            ? "System"
            : "User";
      return `${prefix}:\n${message.content.trim()}`;
    })
    .join("\n\n");

  sections.push("Conversation so far:\n" + conversation);
  sections.push("Assistant response as JSON:");

  return sections.join("\n\n");
}

function safeParseAssistantJson(message: string): AssistantJson | undefined {
  const trimmed = message.trim();
  try {
    const parsed = JSON.parse(trimmed);
    const result = PlanAssistantResponseSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
  } catch (_error) {
    return undefined;
  }
  return undefined;
}

export { planRouter };
