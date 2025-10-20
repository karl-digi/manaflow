export type CrownModelProvider = "anthropic" | "openai";

export interface CrownModelOption {
  id: string;
  label: string;
  provider: CrownModelProvider;
  description?: string;
  requiresApiKeyEnv: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY";
  availableForSelection: boolean;
}

const ANTHROPIC_MODELS: CrownModelOption[] = [
  {
    id: "claude-3-5-sonnet-20241022",
    label: "Claude 3.5 Sonnet (2024-10-22)",
    provider: "anthropic",
    requiresApiKeyEnv: "ANTHROPIC_API_KEY",
    availableForSelection: true,
  },
  {
    id: "claude-3-5-haiku-20241022",
    label: "Claude 3.5 Haiku (2024-10-22)",
    provider: "anthropic",
    requiresApiKeyEnv: "ANTHROPIC_API_KEY",
    availableForSelection: true,
  },
  {
    id: "claude-3-opus-20240229",
    label: "Claude 3 Opus (2024-02-29)",
    provider: "anthropic",
    requiresApiKeyEnv: "ANTHROPIC_API_KEY",
    availableForSelection: true,
  },
];

const OPENAI_MODELS: CrownModelOption[] = [
  {
    id: "gpt-5-mini",
    label: "OpenAI GPT-5 Mini",
    provider: "openai",
    requiresApiKeyEnv: "OPENAI_API_KEY",
    availableForSelection: false,
  },
  {
    id: "gpt-5",
    label: "OpenAI GPT-5",
    provider: "openai",
    requiresApiKeyEnv: "OPENAI_API_KEY",
    availableForSelection: false,
  },
  {
    id: "o4-mini",
    label: "OpenAI o4-mini",
    provider: "openai",
    requiresApiKeyEnv: "OPENAI_API_KEY",
    availableForSelection: false,
  },
];

export const CROWN_MODEL_OPTIONS: CrownModelOption[] = [
  ...ANTHROPIC_MODELS,
  ...OPENAI_MODELS,
];

export const AVAILABLE_CROWN_MODEL_OPTIONS = CROWN_MODEL_OPTIONS.filter(
  (option) => option.availableForSelection,
);

export const DEFAULT_CROWN_MODEL =
  AVAILABLE_CROWN_MODEL_OPTIONS[0] ?? ANTHROPIC_MODELS[0];

export function getDefaultModelForProvider(
  provider: CrownModelProvider,
): CrownModelOption {
  const fromAvailable = AVAILABLE_CROWN_MODEL_OPTIONS.find(
    (option) => option.provider === provider,
  );
  if (fromAvailable) return fromAvailable;

  const fromAll = CROWN_MODEL_OPTIONS.find(
    (option) => option.provider === provider,
  );
  return fromAll ?? DEFAULT_CROWN_MODEL;
}

export function findCrownModelOption(
  modelId: string,
): CrownModelOption | undefined {
  return CROWN_MODEL_OPTIONS.find((option) => option.id === modelId);
}

export function formatProviderLabel(provider: CrownModelProvider): string {
  switch (provider) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    default:
      return provider;
  }
}
