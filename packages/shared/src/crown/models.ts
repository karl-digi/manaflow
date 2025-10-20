export type CrownModelProvider = "anthropic" | "openai";

export interface CrownModelOption {
  id: string; // Unique key combining provider and model (e.g., "anthropic/claude-3-5-sonnet-20241022")
  provider: CrownModelProvider;
  model: string; // Provider-specific model identifier
  label: string; // Human readable label for UI
  description?: string;
  requiresApiKeyEnv: string; // Environment variable required to use the model
  isDefault?: boolean;
}

export const CROWN_MODEL_OPTIONS: readonly CrownModelOption[] = [
  {
    id: "anthropic/claude-3-5-sonnet-20241022",
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    label: "Claude 3.5 Sonnet (Oct 22, 2024)",
    description: "Balanced quality and speed; recommended default for crown evaluations.",
    requiresApiKeyEnv: "ANTHROPIC_API_KEY",
    isDefault: true,
  },
  {
    id: "anthropic/claude-3-5-haiku-20241022",
    provider: "anthropic",
    model: "claude-3-5-haiku-20241022",
    label: "Claude 3.5 Haiku (Oct 22, 2024)",
    description: "Faster evaluations with slightly reduced reasoning depth.",
    requiresApiKeyEnv: "ANTHROPIC_API_KEY",
  },
] as const;

export const DEFAULT_CROWN_MODEL_ID =
  CROWN_MODEL_OPTIONS.find((option) => option.isDefault)?.id ??
  CROWN_MODEL_OPTIONS[0]?.id ??
  "";

export function getCrownModelOption(
  id: string | null | undefined,
): CrownModelOption | undefined {
  if (!id) return undefined;
  return CROWN_MODEL_OPTIONS.find((option) => option.id === id);
}

export function getAvailableCrownModels(
  apiKeyValues: Record<string, string | undefined>,
): CrownModelOption[] {
  return CROWN_MODEL_OPTIONS.filter((option) =>
    Boolean(apiKeyValues[option.requiresApiKeyEnv]?.trim()),
  );
}
