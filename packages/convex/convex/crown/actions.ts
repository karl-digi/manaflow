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
  CROWN_MODEL_OPTIONS,
  DEFAULT_CROWN_MODEL_ID,
  getCrownModelOption,
} from "../../../shared/src/crown/models";
import { resolveTeamIdLoose } from "../../_shared/team";
import { env } from "../../_shared/convex-env";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";

const CrownEvaluationCandidateValidator = v.object({
  runId: v.optional(v.string()),
  agentName: v.optional(v.string()),
  modelName: v.optional(v.string()),
  gitDiff: v.string(),
  newBranch: v.optional(v.union(v.string(), v.null())),
  index: v.optional(v.number()),
});

type CrownModelProvider = "openai" | "anthropic";

type CrownExecutionOptions = {
  preferredModelId?: string | null;
  systemPromptOverride?: string | null;
  apiKeys: Record<string, string | undefined>;
};

type ResolvedCrownModel = {
  provider: CrownModelProvider;
  model: LanguageModel;
  optionId: string;
};

const DEFAULT_EVALUATION_SYSTEM_PROMPT =
  "You select the best implementation from structured diff inputs and explain briefly why.";

function getEffectiveKey(
  envVar: string,
  apiKeys: Record<string, string | undefined>,
): string | undefined {
  const value = apiKeys[envVar] ??
    (envVar === "OPENAI_API_KEY"
      ? env.OPENAI_API_KEY
      : envVar === "ANTHROPIC_API_KEY"
        ? env.ANTHROPIC_API_KEY
        : undefined);
  return value?.trim() ? value.trim() : undefined;
}

function resolveCrownModel(options: CrownExecutionOptions): ResolvedCrownModel {
  const preferredOption = getCrownModelOption(options.preferredModelId);
  const preferredKey = preferredOption
    ? getEffectiveKey(preferredOption.requiresApiKeyEnv, options.apiKeys)
    : undefined;

  if (preferredOption && preferredKey) {
    return instantiateModel(preferredOption.provider, preferredOption.model, preferredKey, preferredOption.id);
  }

  for (const option of CROWN_MODEL_OPTIONS) {
    const key = getEffectiveKey(option.requiresApiKeyEnv, options.apiKeys);
    if (!key) continue;
    return instantiateModel(option.provider, option.model, key, option.id);
  }

  throw new ConvexError(
    "Crown evaluation is not configured (missing required API key)",
  );
}

function instantiateModel(
  provider: CrownModelProvider,
  modelId: string,
  apiKey: string,
  optionId: string,
): ResolvedCrownModel {
  if (provider === "openai") {
    const openai = createOpenAI({ apiKey });
    return { provider, model: openai(modelId), optionId };
  }

  const anthropic = createAnthropic({ apiKey });
  return { provider, model: anthropic(modelId), optionId };
}

export async function performCrownEvaluation(
  prompt: string,
  candidates: CrownEvaluationCandidate[],
  options: CrownExecutionOptions,
): Promise<CrownEvaluationResponse> {
  const { model, provider } = resolveCrownModel(options);

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

  const systemPrompt =
    options.systemPromptOverride?.trim() || DEFAULT_EVALUATION_SYSTEM_PROMPT;

  try {
    const { object } = await generateObject({
      model,
      schema: CrownEvaluationResponseSchema,
      system: systemPrompt,
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
  options: CrownExecutionOptions,
): Promise<CrownSummarizationResponse> {
  const { model, provider } = resolveCrownModel(options);

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
    requestingUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ?? args.requestingUserId;
    if (!userId) {
      throw new ConvexError("Crown evaluation requires authentication");
    }

    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const [settings, apiKeys] = await Promise.all([
      ctx.runQuery(internal.workspaceSettings.getByTeamAndUserInternal, {
        teamId,
        userId,
      }),
      ctx.runQuery(internal.apiKeys.getAllByTeamAndUserInternal, {
        teamId,
        userId,
      }),
    ]);

    const preferredModelId =
      settings?.crownModel ?? DEFAULT_CROWN_MODEL_ID ?? null;
    const systemPromptOverride = settings?.crownSystemPrompt ?? null;

    const effectiveApiKeys: Record<string, string | undefined> = {
      OPENAI_API_KEY: apiKeys.OPENAI_API_KEY ?? env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: apiKeys.ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY,
    };

    return performCrownEvaluation(args.prompt, args.candidates, {
      preferredModelId,
      systemPromptOverride,
      apiKeys: effectiveApiKeys,
    });
  },
});

export const summarize = action({
  args: {
    prompt: v.string(),
    gitDiff: v.string(),
    teamSlugOrId: v.string(),
    requestingUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject ?? args.requestingUserId;
    if (!userId) {
      throw new ConvexError("Crown summarization requires authentication");
    }

    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const [settings, apiKeys] = await Promise.all([
      ctx.runQuery(internal.workspaceSettings.getByTeamAndUserInternal, {
        teamId,
        userId,
      }),
      ctx.runQuery(internal.apiKeys.getAllByTeamAndUserInternal, {
        teamId,
        userId,
      }),
    ]);

    const preferredModelId =
      settings?.crownModel ?? DEFAULT_CROWN_MODEL_ID ?? null;

    const effectiveApiKeys: Record<string, string | undefined> = {
      OPENAI_API_KEY: apiKeys.OPENAI_API_KEY ?? env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: apiKeys.ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY,
    };

    return performCrownSummarization(args.prompt, args.gitDiff, {
      preferredModelId,
      apiKeys: effectiveApiKeys,
      systemPromptOverride: null,
    });
  },
});
