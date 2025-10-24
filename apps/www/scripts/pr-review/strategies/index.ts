import { jsonLinesStrategy } from "./json-lines";
import { lineNumbersStrategy } from "./line-numbers";
import { inlinePhraseStrategy } from "./inline-phrase";
import { inlineBracketsStrategy } from "./inline-brackets";
import type { ReviewStrategy } from "../core/types";
import type { PrReviewStrategyId } from "../core/options";

const STRATEGY_MAP: Record<PrReviewStrategyId, ReviewStrategy> = {
  "json-lines": jsonLinesStrategy,
  "line-numbers": lineNumbersStrategy,
  "inline-phrase": inlinePhraseStrategy,
  "inline-brackets": inlineBracketsStrategy,
};

export function resolveStrategy(id: PrReviewStrategyId): ReviewStrategy {
  return STRATEGY_MAP[id];
}

export const AVAILABLE_STRATEGIES: ReviewStrategy[] = Object.values(
  STRATEGY_MAP
);
