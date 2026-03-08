/**
 * Types and utilities for iframe preflight checks.
 *
 * Preflight checks verify that sandbox endpoints are reachable
 * before attempting to render them in iframes.
 */

/**
 * Server-side phases during preflight processing.
 * Used to communicate progress to the client via SSE.
 */
const IFRAME_PREFLIGHT_SERVER_PHASES = [
  "resuming",
  "resume_retry",
  "resumed",
  "already_ready",
  "ready",
  "resume_failed",
  "resume_forbidden",
  "instance_not_found",
  "preflight_failed",
  "error",
] as const;

type KnownRecord = Record<string, unknown>;

/** A phase in the iframe preflight process */
export type IframePreflightServerPhase =
  (typeof IFRAME_PREFLIGHT_SERVER_PHASES)[number];

/** Payload sent from server during preflight, includes phase and optional extra data */
export type IframePreflightPhasePayload = {
  phase: IframePreflightServerPhase;
} & KnownRecord;

/** HTTP method used for the preflight check */
export type IframePreflightMethod = "HEAD" | "GET";

/** Result of an iframe preflight check */
export interface IframePreflightResult {
  /** Whether the preflight check succeeded */
  ok: boolean;
  /** HTTP status code from the check, or null if request failed */
  status: number | null;
  /** HTTP method used for the check */
  method: IframePreflightMethod | null;
  /** Error message if the check failed */
  error?: string;
}

/** Function type for sending preflight phase updates to clients */
export type SendPhaseFn = (
  phase: IframePreflightServerPhase,
  extra?: KnownRecord,
) => Promise<void>;

/**
 * Type guard to check if a value is a plain object.
 */
const isRecord = (value: unknown): value is KnownRecord =>
  typeof value === "object" && value !== null;

/**
 * Type guard to check if a value is a valid IframePreflightServerPhase.
 */
export const isIframePreflightServerPhase = (
  value: unknown,
): value is IframePreflightServerPhase => {
  if (typeof value !== "string") {
    return false;
  }
  switch (value) {
    case "resuming":
    case "resume_retry":
    case "resumed":
    case "already_ready":
    case "ready":
    case "resume_failed":
    case "resume_forbidden":
    case "instance_not_found":
    case "preflight_failed":
    case "error":
      return true;
    default:
      return false;
  }
};

/**
 * Type guard to check if a value is a valid IframePreflightPhasePayload.
 */
export const isIframePreflightPhasePayload = (
  value: unknown,
): value is IframePreflightPhasePayload => {
  if (!isRecord(value)) {
    return false;
  }

  if (!isIframePreflightServerPhase(value.phase)) {
    return false;
  }

  return true;
};

/**
 * Type guard to check if a value is a valid IframePreflightResult.
 */
export const isIframePreflightResult = (
  value: unknown,
): value is IframePreflightResult => {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.ok !== "boolean") {
    return false;
  }

  if (value.status !== null && typeof value.status !== "number") {
    return false;
  }

  const method = value.method;
  if (method !== null && method !== "HEAD" && method !== "GET") {
    return false;
  }

  if (
    "error" in value &&
    value.error !== undefined &&
    typeof value.error !== "string"
  ) {
    return false;
  }

  return true;
};
