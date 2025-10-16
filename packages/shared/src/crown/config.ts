import type { CrownHarnessOption, CrownHarnessProvider, CrownHarnessId, CrownModelOption } from "./types";

export const DEFAULT_CROWN_SYSTEM_PROMPT =
  "You select the best implementation from structured diff inputs and explain briefly why.";

export const DEFAULT_CROWN_HARNESS_ID: CrownHarnessId = "cmux-default";
export const DEFAULT_CROWN_MODEL_ID = "claude-3-5-sonnet-20241022";

const CLAUDE_MODELS: CrownModelOption[] = [
  {
    id: "claude-3-5-sonnet-20241022",
    label: "Claude 3.5 Sonnet (2024-10-22)",
  },
  {
    id: "claude-3-5-haiku-20241022",
    label: "Claude 3.5 Haiku (2024-10-22)",
  },
  {
    id: "claude-3-opus-20240229",
    label: "Claude 3 Opus (2024-02-29)",
  },
];

const OPENAI_MODELS: CrownModelOption[] = [
  { id: "o4-mini", label: "OpenAI o4-mini" },
  { id: "o3-mini", label: "OpenAI o3-mini" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
];

const GEMINI_MODELS: CrownModelOption[] = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
];

export const CROWN_HARNESS_OPTIONS = [
  {
    id: "cmux-default",
    label: "cmux default (Claude Sonnet)",
    description: "Use the cmux-managed Claude Sonnet 3.5 key for scoring.",
    provider: "anthropic" as CrownHarnessProvider,
    requiresApiKey: null,
    usesCmuxKey: true,
    models: CLAUDE_MODELS,
  },
  {
    id: "anthropic",
    label: "Anthropic (your key)",
    description: "Score with your Anthropic account.",
    provider: "anthropic" as CrownHarnessProvider,
    requiresApiKey: "ANTHROPIC_API_KEY",
    models: CLAUDE_MODELS,
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "Use OpenAI reasoning models for crown scoring.",
    provider: "openai" as CrownHarnessProvider,
    requiresApiKey: "OPENAI_API_KEY",
    models: OPENAI_MODELS,
  },
  {
    id: "gemini",
    label: "Gemini",
    description: "Use Gemini models for crown scoring.",
    provider: "gemini" as CrownHarnessProvider,
    requiresApiKey: "GEMINI_API_KEY",
    models: GEMINI_MODELS,
  },
] satisfies ReadonlyArray<CrownHarnessOption>;

export const CROWN_HARNESS_OPTIONS_BY_ID = Object.fromEntries(
  CROWN_HARNESS_OPTIONS.map((option) => [option.id, option]),
) as Record<CrownHarnessId, CrownHarnessOption>;

export function getDefaultModelForHarness(
  harnessId: CrownHarnessId,
): string {
  const option = CROWN_HARNESS_OPTIONS_BY_ID[harnessId];
  return option?.models[0]?.id ?? DEFAULT_CROWN_MODEL_ID;
}
