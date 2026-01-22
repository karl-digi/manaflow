import { Effect } from "effect";
import * as OtelTracer from "@effect/opentelemetry/Tracer";

/**
 * Trace context that can be serialized and passed across action boundaries.
 * This enables linking traces from parent actions to child actions.
 */
export type TraceContext = {
  traceId: string;
  spanId: string;
  traceFlags?: number;
};

/**
 * Extract the current trace context from the running Effect.
 * Returns null if no trace context is available.
 *
 * Use this before scheduling a child action to capture the parent context.
 */
export const getTraceContext: Effect.Effect<TraceContext | null, never, never> =
  OtelTracer.currentOtelSpan.pipe(
    Effect.map((span) => {
      const ctx = span.spanContext();
      return {
        traceId: ctx.traceId,
        spanId: ctx.spanId,
        traceFlags: ctx.traceFlags,
      };
    }),
    Effect.catchAll(() => Effect.succeed(null))
  );

/**
 * Run an Effect with a parent trace context.
 * This links the new spans to the parent trace from a previous action.
 *
 * Uses @effect/opentelemetry's makeExternalSpan to create an OpenTelemetry-compatible
 * external span that properly propagates trace context.
 *
 * @param traceContext - The trace context from the parent action (can be null/undefined)
 * @returns A function that wraps an Effect with the parent span
 */
export function withTraceContext(
  traceContext: TraceContext | null | undefined
): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> {
  return <A, E, R>(effect: Effect.Effect<A, E, R>) => {
    if (!traceContext) {
      return effect;
    }
    const parentSpan = OtelTracer.makeExternalSpan({
      traceId: traceContext.traceId,
      spanId: traceContext.spanId,
      traceFlags: traceContext.traceFlags,
    });
    return Effect.withParentSpan(effect, parentSpan);
  };
}
