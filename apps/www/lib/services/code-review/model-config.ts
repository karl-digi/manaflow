import type { ModelConfig } from "./run-simple-anthropic-review";

type SearchParamsRecord = {
  [key: string]: string | string[] | undefined;
};

const FINE_TUNED_OPENAI_MODEL_ID =
  "ft:gpt-4.1-mini-2025-04-14:lawrence:cmux-heatmap-sft:CZW6Lc77";

function createFineTunedOpenAiConfig(): ModelConfig {
  return {
    provider: "openai",
    model: FINE_TUNED_OPENAI_MODEL_ID,
  };
}

export function parseModelConfigFromRecord(
  searchParams: SearchParamsRecord
): ModelConfig | undefined {
  if ("ft0" in searchParams) {
    return createFineTunedOpenAiConfig();
  }
  return undefined;
}

export function parseModelConfigFromUrlSearchParams(
  searchParams: URLSearchParams
): ModelConfig | undefined {
  if (searchParams.has("ft0")) {
    return createFineTunedOpenAiConfig();
  }
  return undefined;
}
