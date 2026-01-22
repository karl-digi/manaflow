import { Effect, Layer } from "effect";

export function runEffect<A>(effect: Effect.Effect<A, unknown, never>): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.tapError((error) => {
        const detail = error instanceof Error ? error : new Error(String(error));
        console.error("[effect.runtime] Unhandled error", detail);
        return Effect.void;
      })
    )
  );
}

/**
 * Run an Effect with a layer that provides tracer context.
 * Use this at action boundaries to establish tracing context that
 * child spans can inherit from.
 */
export function runTracedEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.tapError((error) => {
        const detail = error instanceof Error ? error : new Error(String(error));
        console.error("[effect.runtime] Unhandled error", detail);
        return Effect.void;
      }),
      Effect.provide(layer)
    )
  );
}
