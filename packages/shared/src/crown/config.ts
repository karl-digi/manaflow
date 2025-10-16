export type CrownHarnessId = "standard" | "scorecard";

export interface CrownHarnessOption {
  id: CrownHarnessId;
  label: string;
  description: string;
}

export const CROWN_HARNESS_OPTIONS: readonly CrownHarnessOption[] = [
  {
    id: "standard",
    label: "Standard code review",
    description:
      "Pick the most complete and correct implementation by comparing diffs side-by-side.",
  },
  {
    id: "scorecard",
    label: "Scorecard (balanced)",
    description:
      "Score each candidate on quality, safety, and completeness before choosing a winner.",
  },
];

export const DEFAULT_CROWN_HARNESS_ID: CrownHarnessId = "standard";

export type CrownModelId =
  | "anthropic/claude-3-5-sonnet-20241022"
  | "anthropic/claude-3-5-haiku-20241022"
  | "anthropic/claude-3-5-sonnet-20240620";

export interface CrownModelOption {
  id: CrownModelId;
  label: string;
  provider: "anthropic";
  model: string;
  envVar: "ANTHROPIC_API_KEY";
}

export const CROWN_MODEL_OPTIONS: readonly CrownModelOption[] = [
  {
    id: "anthropic/claude-3-5-sonnet-20241022",
    label: "Claude 3.5 Sonnet (October 2024)",
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    envVar: "ANTHROPIC_API_KEY",
  },
  {
    id: "anthropic/claude-3-5-haiku-20241022",
    label: "Claude 3.5 Haiku (October 2024)",
    provider: "anthropic",
    model: "claude-3-5-haiku-20241022",
    envVar: "ANTHROPIC_API_KEY",
  },
  {
    id: "anthropic/claude-3-5-sonnet-20240620",
    label: "Claude 3.5 Sonnet (June 2024)",
    provider: "anthropic",
    model: "claude-3-5-sonnet-20240620",
    envVar: "ANTHROPIC_API_KEY",
  },
];

export const DEFAULT_CROWN_MODEL_ID: CrownModelId =
  "anthropic/claude-3-5-sonnet-20241022";

export const DEFAULT_CROWN_SYSTEM_PROMPT =
  "You select the best implementation from structured diff inputs and explain briefly why.";

export function getCrownModelOption(id: string | undefined | null) {
  if (!id) return undefined;
  return CROWN_MODEL_OPTIONS.find((option) => option.id === id);
}

export function getCrownHarnessOption(id: string | undefined | null) {
  if (!id) return undefined;
  return CROWN_HARNESS_OPTIONS.find((option) => option.id === id);
}
