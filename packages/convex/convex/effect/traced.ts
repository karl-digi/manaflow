import { Effect } from "effect";
import { withObservability, type ObservabilityAttributes } from "./observability";

/**
 * Wrap a Promise-returning operation in an Effect with tracing.
 * When composed with other Effects, creates proper parent-child span relationships.
 *
 * Use this inside Effect.gen or pipe chains to create traced operations that
 * inherit tracer context from their parent span.
 */
export function traced<T>(
  name: string,
  attributes: ObservabilityAttributes,
  task: () => Promise<T>
): Effect.Effect<T, Error> {
  return Effect.tryPromise({
    try: task,
    catch: (error) => {
      console.error(`[${name}] Error:`, error);
      return error instanceof Error ? error : new Error(`${name} failed`);
    },
  }).pipe(withObservability(name, attributes));
}
