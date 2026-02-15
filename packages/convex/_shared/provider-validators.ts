import { v, type Validator } from "convex/values";
import {
  CONFIG_PROVIDERS,
  DEVBOX_PROVIDERS,
  RUNTIME_PROVIDERS,
  SNAPSHOT_PROVIDERS,
} from "@cmux/shared/provider-types";

// Return-type annotation is necessary because `.map()` widens literal types
// to `string`. The cast is safe: the runtime validator matches `T[number]` exactly.
function literalsFromTuple<const T extends readonly [string, string, ...string[]]>(
  values: T,
): Validator<T[number]> {
  const [first, second, ...rest] = values;
  return v.union(
    v.literal(first),
    v.literal(second),
    ...rest.map((value) => v.literal(value)),
  ) as Validator<T[number]>;
}

export const runtimeProviderValidator = literalsFromTuple(RUNTIME_PROVIDERS);
export const snapshotProviderValidator = literalsFromTuple(SNAPSHOT_PROVIDERS);
export const devboxProviderValidator = literalsFromTuple(DEVBOX_PROVIDERS);
export const configProviderValidator = literalsFromTuple(CONFIG_PROVIDERS);
