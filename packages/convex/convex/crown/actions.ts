"use node";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, type LanguageModel } from "ai";
import { ConvexError, v } from "convex/values";
import {
  CrownEvaluationResponseSchema,
  CrownSummarizationResponseSchema,
  type CrownEvaluationCandidate,
  type CrownEvaluationResponse,
  type CrownSummarizationResponse,
} from "../../../shared/src/convex-safe";
import {
  AVAILABLE_CROWN_MODEL_OPTIONS,
  DEFAULT_CROWN_MODEL,
  findCrownModelOption,
  getDefaultModelForProvider,
  type CrownModelOption,
  type CrownModelProvider,
} from "../../../shared/src/crown/config";
import { env } from "../../_shared/convex-env";
import { resolveTeamIdLoose } from "../../_shared/team";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { action } from "../_generated/server";

const CrownEvaluationCandidateValidator = v.object({
  runId: v.optional(v.string()),
  agentName: v.optional(v.string()),
  modelName: v.optional(v.string()),
  gitDiff: v.string(),
  newBranch: v.optional(v.union(v.string(), v.null())),
  index: v.optional(v.number()),
});

type WorkspaceCrownSettings = Pick<
  Doc<"workspaceSettings">,
  "crownModel" | "crownModelProvider" | "crownSystemPrompt"
>;

const DEFAULT_EVALUATION_SYSTEM_PROMPT =
  "You select the best implementation from structured diff inputs and explain briefly why.";

function normalizeProvider(provider?: string | null): CrownModelProvider {
  return provider === "openai" ? "openai" : "anthropic";
}

function resolveSelectedModel(
  settings?: WorkspaceCrownSettings | null,
): CrownModelOption {
  const preferredProvider = normalizeProvider(settings?.crownModelProvider);
  const candidate = settings?.crownModel
    ? findCrownModelOption(settings.crownModel)
    : undefined;

  let option = candidate;
  if (!option || option.provider !== preferredProvider) {
    option = getDefaultModelForProvider(preferredProvider);
  }

  if (
    option.provider !== "openai" &&
    !AVAILABLE_CROWN_MODEL_OPTIONS.some((item) => item.id === option.id)
  ) {
    option = DEFAULT_CROWN_MODEL;
  }

  return option;
}

function ensureModelForProvider(option: CrownModelOption): CrownModelOption {
  if (option.provider === "openai") {
    if (!AVAILABLE_CROWN_MODEL_OPTIONS.some((item) => item.id === option.id)) {
      // For now crown only supports Claude models; fall back gracefully.
      return DEFAULT_CROWN_MODEL;
    }

    if (!env.OPENAI_API_KEY) {
      throw new ConvexError(
        "OpenAI crown evaluation requires OPENAI_API_KEY to be configured.",
      );
    }

    return option;
  }

  if (!env.ANTHROPIC_API_KEY) {
    throw new ConvexError(
      "Anthropic crown evaluation requires ANTHROPIC_API_KEY to be configured.",
    );
  }

  if (!AVAILABLE_CROWN_MODEL_OPTIONS.some((item) => item.id === option.id)) {
    return DEFAULT_CROWN_MODEL;
  }

  return option;
}

function resolveCrownModel(
  settings?: WorkspaceCrownSettings | null,
): {
  provider: CrownModelProvider;
  modelId: string;
  model: LanguageModel;
} {
  const selected = ensureModelForProvider(resolveSelectedModel(settings));

  if (selected.provider === "openai") {
    const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY! });
    return {
      provider: "openai",
      modelId: selected.id,
      model: openai(selected.id),
    };
  }

  const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY! });
  return {
    provider: "anthropic",
    modelId: selected.id,
    model: anthropic(selected.id),
  };
}

function resolveEvaluationSystemPrompt(
  settings?: WorkspaceCrownSettings | null,
): string {
  const custom = settings?.crownSystemPrompt?.trim();
  if (custom && custom.length > 0) return custom;
  return DEFAULT_EVALUATION_SYSTEM_PROMPT;
}

export async function performCrownEvaluation(
  prompt: string,
  candidates: CrownEvaluationCandidate[],
  options?: { workspaceSettings?: WorkspaceCrownSettings | null },
): Promise<CrownEvaluationResponse> {
  const { model, provider, modelId } = resolveCrownModel(
    options?.workspaceSettings,
  );

  const normalizedCandidates = candidates.map((candidate, idx) => {
    const resolvedIndex = candidate.index ?? idx;
    return {
      index: resolvedIndex,
      runId: candidate.runId,
      agentName: candidate.agentName,
      modelName:
        candidate.modelName ??
        candidate.agentName ??
        (candidate.runId ? `run-${candidate.runId}` : undefined) ??
        `candidate-${resolvedIndex}`,
      gitDiff: candidate.gitDiff,
      newBranch: candidate.newBranch ?? null,
    };
  });

  const evaluationData = {
    prompt,
    candidates: normalizedCandidates,
  };

  const evaluationPrompt = `You are evaluating code implementations from different AI models.

Here are the candidates to evaluate:
${JSON.stringify(evaluationData, null, 2)}

NOTE: The git diffs shown contain only actual code changes. Lock files, build artifacts, and other non-essential files have been filtered out.

Analyze these implementations and select the best one based on:
1. Code quality and correctness
2. Completeness of the solution
3. Following best practices
4. Actually having meaningful code changes (if one has no changes, prefer the one with changes)

Respond with a JSON object containing:
- "winner": the index (0-based) of the best implementation
- "reason": a brief explanation of why this implementation was chosen

Example response:
{"winner": 0, "reason": "Model claude/sonnet-4 provided a more complete implementation with better error handling and cleaner code structure."}

IMPORTANT: Respond ONLY with the JSON object, no other text.`;

  try {
    const { object } = await generateObject({
      model,
      schema: CrownEvaluationResponseSchema,
      system: resolveEvaluationSystemPrompt(options?.workspaceSettings),
      prompt: evaluationPrompt,
      ...(provider === "openai" ? {} : { temperature: 0 }),
      maxRetries: 2,
    });

    return CrownEvaluationResponseSchema.parse(object);
  } catch (error) {
    console.error("[convex.crown] Evaluation error", error);
    throw new ConvexError("Evaluation failed");
  }
}

export async function performCrownSummarization(
  prompt: string,
  gitDiff: string,
  options?: { workspaceSettings?: WorkspaceCrownSettings | null },
): Promise<CrownSummarizationResponse> {
  const { model, provider } = resolveCrownModel(
    options?.workspaceSettings,
  );

  const summarizationPrompt = `You are an expert reviewer summarizing a pull request.

GOAL
- Explain succinctly what changed and why.
- Call out areas the user should review carefully.
- Provide a quick test plan to validate the changes.

CONTEXT
- User's original request:
${prompt}
- Relevant diffs (unified):
${gitDiff || "<no code changes captured>"}

INSTRUCTIONS
- Base your summary strictly on the provided diffs and request.
- Be specific about files and functions when possible.
- Prefer clear bullet points over prose. Keep it under ~300 words.
- If there are no code changes, say so explicitly and suggest next steps.

OUTPUT FORMAT (Markdown)
## PR Review Summary
- What Changed: bullet list
- Review Focus: bullet list (risks/edge cases)
- Test Plan: bullet list of practical steps
- Follow-ups: optional bullets if applicable
`;

  try {
    const { object } = await generateObject({
      model,
      schema: CrownSummarizationResponseSchema,
      system:
        "You are an expert reviewer summarizing pull requests. Provide a clear, concise summary following the requested format.",
      prompt: summarizationPrompt,
      ...(provider === "openai" ? {} : { temperature: 0 }),
      maxRetries: 2,
    });

    return CrownSummarizationResponseSchema.parse(object);
  } catch (error) {
    console.error("[convex.crown] Summarization error", error);
    throw new ConvexError("Summarization failed");
  }
}

export const evaluate = action({
  args: {
    prompt: v.string(),
    candidates: v.array(CrownEvaluationCandidateValidator),
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const identity = await ctx.auth.getUserIdentity();
    const workspaceSettings = identity
      ? await ctx.runQuery(
          internal.workspaceSettings.getByTeamAndUserInternal,
          {
            teamId,
            userId: identity.subject,
          },
        )
      : null;

    return performCrownEvaluation(args.prompt, args.candidates, {
      workspaceSettings,
    });
  },
});

export const summarize = action({
  args: {
    prompt: v.string(),
    gitDiff: v.string(),
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const identity = await ctx.auth.getUserIdentity();
    const workspaceSettings = identity
      ? await ctx.runQuery(
          internal.workspaceSettings.getByTeamAndUserInternal,
          {
            teamId,
            userId: identity.subject,
          },
        )
      : null;

    return performCrownSummarization(args.prompt, args.gitDiff, {
      workspaceSettings,
    });
  },
});
