export type IframePreflightResumeStatus =
  | "starting"
  | "attempt"
  | "success"
  | "failed"
  | "instance_not_found";

export interface IframePreflightResumeEventBase {
  readonly type: "resume";
  readonly instanceId: string;
}

export type IframePreflightResumeEvent =
  | (IframePreflightResumeEventBase & {
      readonly status: "starting";
    })
  | (IframePreflightResumeEventBase & {
      readonly status: "attempt";
      readonly attempt: number;
    })
  | (IframePreflightResumeEventBase & {
      readonly status: "success";
      readonly attempts: number;
    })
  | (IframePreflightResumeEventBase & {
      readonly status: "failed";
      readonly attempts: number;
      readonly error?: string;
    })
  | (IframePreflightResumeEventBase & {
      readonly status: "instance_not_found";
    });

export interface IframePreflightResultEvent {
  readonly type: "preflight";
  readonly ok: boolean;
  readonly status: number | null;
  readonly method: "HEAD" | "GET" | null;
  readonly error?: string;
}

export interface IframePreflightErrorEvent {
  readonly type: "error";
  readonly error: string;
}

export type IframePreflightStreamEvent =
  | IframePreflightResumeEvent
  | IframePreflightResultEvent
  | IframePreflightErrorEvent;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

export function isIframePreflightStreamEvent(
  input: unknown,
): input is IframePreflightStreamEvent {
  if (!isObject(input)) {
    return false;
  }

  const { type } = input;

  if (type === "error") {
    return typeof input.error === "string";
  }

  if (type === "preflight") {
    const { ok, status, method, error } = input;

    const validOk = typeof ok === "boolean";
    const validStatus =
      status === null || (isFiniteInteger(status) && status >= 0 && status <= 599);
    const validMethod = method === null || method === "HEAD" || method === "GET";
    const validError = error === undefined || typeof error === "string";

    return validOk && validStatus && validMethod && validError;
  }

  if (type === "resume") {
    const { instanceId, status } = input;

    if (typeof instanceId !== "string") {
      return false;
    }
    if (
      status !== "starting" &&
      status !== "attempt" &&
      status !== "success" &&
      status !== "failed" &&
      status !== "instance_not_found"
    ) {
      return false;
    }

    if (status === "attempt") {
      return isFiniteInteger(input.attempt) && input.attempt >= 1;
    }

    if (status === "success" || status === "failed") {
      if (!isFiniteInteger(input.attempts) || input.attempts < 1) {
        return false;
      }
      if (status === "failed" && input.error !== undefined) {
        return typeof input.error === "string";
      }
      return true;
    }

    if (status === "starting" || status === "instance_not_found") {
      return true;
    }
  }

  return false;
}

export function encodeIframePreflightStreamEvent(
  event: IframePreflightStreamEvent,
): string {
  return `${JSON.stringify(event)}\n`;
}
