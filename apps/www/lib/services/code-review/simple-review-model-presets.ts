export const SIMPLE_REVIEW_MODEL_PRESETS = {
  ft0: {
    provider: "openai" as const,
    modelId:
      "ft:gpt-4.1-mini-2025-04-14:lawrence:cmux-heatmap-sft:CZW6Lc77",
    queryFlag: "ft0",
  },
} as const;

export type SimpleReviewModelPreset = keyof typeof SIMPLE_REVIEW_MODEL_PRESETS;

export type SearchParamsRecord = Record<
  string,
  string | string[] | undefined
>;

const presetEntries = Object.entries(
  SIMPLE_REVIEW_MODEL_PRESETS
) as [SimpleReviewModelPreset, (typeof SIMPLE_REVIEW_MODEL_PRESETS)[SimpleReviewModelPreset]][];

function hasFlagInRecord(record: SearchParamsRecord, flag: string): boolean {
  if (!(flag in record)) {
    return false;
  }
  const value = record[flag];
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== undefined;
}

function hasFlagInUrlParams(params: URLSearchParams, flag: string): boolean {
  return params.has(flag);
}

export function resolveSimpleReviewModelPresetFromRecord(
  params?: SearchParamsRecord | null
): SimpleReviewModelPreset | null {
  if (!params) {
    return null;
  }

  for (const [preset, config] of presetEntries) {
    if (hasFlagInRecord(params, config.queryFlag)) {
      return preset;
    }
  }

  return null;
}

export function resolveSimpleReviewModelPresetFromUrlSearchParams(
  params?: URLSearchParams | null
): SimpleReviewModelPreset | null {
  if (!params) {
    return null;
  }

  for (const [preset, config] of presetEntries) {
    if (hasFlagInUrlParams(params, config.queryFlag)) {
      return preset;
    }
  }

  return null;
}
