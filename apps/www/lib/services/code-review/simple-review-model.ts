export type SimpleReviewModelVariant = "anthropic-opus" | "openai-ft0";

export const DEFAULT_SIMPLE_REVIEW_MODEL_VARIANT: SimpleReviewModelVariant =
  "anthropic-opus";

export const SIMPLE_REVIEW_MODEL_QUERY_FLAG = "ft0";

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export function parseSimpleReviewModelVariantFromRecord(
  searchParams?: SearchParamsRecord | null
): SimpleReviewModelVariant {
  if (!searchParams) {
    return DEFAULT_SIMPLE_REVIEW_MODEL_VARIANT;
  }

  const rawValue = searchParams[SIMPLE_REVIEW_MODEL_QUERY_FLAG];
  if (typeof rawValue === "undefined") {
    return DEFAULT_SIMPLE_REVIEW_MODEL_VARIANT;
  }

  if (Array.isArray(rawValue)) {
    return rawValue.length > 0
      ? "openai-ft0"
      : DEFAULT_SIMPLE_REVIEW_MODEL_VARIANT;
  }

  return "openai-ft0";
}
