import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { env } from "@/lib/utils/www-env";
import {
  encodeIframePreflightStreamEvent,
  type IframePreflightResultEvent,
  type IframePreflightResumeEvent,
  type IframePreflightStreamEvent,
} from "@cmux/shared/morph-iframe-preflight";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { stream } from "hono/streaming";
import { MorphCloudClient } from "morphcloud";

const ALLOWED_HOST_SUFFIXES = [
  ".cmux.sh",
  ".cmux.dev",
  ".cmux.local",
  ".cmux.localhost",
  ".cmux.app",
  ".autobuild.app",
  ".http.cloud.morph.so",
  ".vm.freestyle.sh",
] as const;

const ALLOWED_EXACT_HOSTS = new Set<string>([
  "cmux.sh",
  "www.cmux.sh",
  "cmux.dev",
  "www.cmux.dev",
  "cmux.local",
  "cmux.localhost",
  "cmux.app",
]);

const DEV_ONLY_HOSTS = new Set<string>(["localhost", "127.0.0.1", "::1"]);

const CMUX_MORPH_PROXY_SUFFIXES = new Set<string>([
  ".cmux.sh",
  ".cmux.dev",
  ".cmux.local",
  ".cmux.localhost",
  ".cmux.app",
]);

const MORPH_DIRECT_SUFFIX = ".http.cloud.morph.so";
const MORPH_FREESTYLE_SUFFIX = ".vm.freestyle.sh";
const MORPH_ID_PATTERN = /^[a-z0-9-]+$/;
const RESUME_MAX_ATTEMPTS = 3;
const RESUME_RETRY_BASE_DELAY_MS = 1_000;

function isAllowedHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  if (ALLOWED_EXACT_HOSTS.has(normalized)) {
    return true;
  }

  if (ALLOWED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }

  const isDevelopment = process.env.NODE_ENV !== "production";

  if (isDevelopment && DEV_ONLY_HOSTS.has(normalized)) {
    return true;
  }

  return false;
}

function stripSuffix(hostname: string, suffix: string): string | null {
  if (!hostname.endsWith(suffix)) {
    return null;
  }
  const withoutSuffix = hostname.slice(0, -suffix.length);
  if (withoutSuffix.endsWith(".")) {
    return withoutSuffix.slice(0, -1);
  }
  return withoutSuffix;
}

function isValidMorphId(value: string | null | undefined): value is string {
  return typeof value === "string" && MORPH_ID_PATTERN.test(value);
}

type MorphInstanceCandidate = {
  instanceId: string;
};

function parseMorphInstanceCandidate(target: URL): MorphInstanceCandidate | null {
  const host = target.hostname.toLowerCase();

  const directSubdomain = stripSuffix(host, MORPH_DIRECT_SUFFIX);
  if (directSubdomain) {
    const morphMatch = directSubdomain.match(/^(?:port-\d+-)?morphvm-([^.]+)$/);
    if (morphMatch && isValidMorphId(morphMatch[1])) {
      const morphId = morphMatch[1];
      return { instanceId: `morphvm_${morphId}` };
    }

    const portPrefixed = directSubdomain.match(/^port-\d+-(.+)$/);
    if (portPrefixed && isValidMorphId(portPrefixed[1])) {
      return { instanceId: `morphvm_${portPrefixed[1]}` };
    }
  }

  for (const suffix of CMUX_MORPH_PROXY_SUFFIXES) {
    const subdomain = stripSuffix(host, suffix);
    if (!subdomain) {
      continue;
    }

    if (subdomain.startsWith("cmux-")) {
      const parts = subdomain.split("-");
      if (parts.length >= 4) {
        const morphId = parts[1];
        if (isValidMorphId(morphId)) {
          return { instanceId: `morphvm_${morphId}` };
        }
      }
    }

    if (subdomain.startsWith("port-")) {
      const parts = subdomain.split("-").filter(Boolean);
      if (parts.length >= 3) {
        const maybePort = parts[1];
        const morphId = parts.slice(2).join("-");
        if (/^\d+$/.test(maybePort) && isValidMorphId(morphId)) {
          return { instanceId: `morphvm_${morphId}` };
        }
      }
    }

    const parts = subdomain.split("-").filter(Boolean);
    if (parts.length >= 2) {
      const maybePort = parts.at(-2);
      const morphId = parts.at(-1);
      if (maybePort && /^\d+$/.test(maybePort) && isValidMorphId(morphId)) {
        return { instanceId: `morphvm_${morphId}` };
      }
    }
  }

  const freestyleSubdomain = stripSuffix(host, MORPH_FREESTYLE_SUFFIX);
  if (freestyleSubdomain && isValidMorphId(freestyleSubdomain)) {
    return { instanceId: `morphvm_${freestyleSubdomain}` };
  }

  return null;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.includes("The operation was aborted"))
  );
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      resolve();
    }, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

type ResumeOutcome = "success" | "failed" | "not_found" | "aborted" | "skipped";

async function attemptResumeInstance(
  instanceId: string,
  signal: AbortSignal,
  send: (event: IframePreflightStreamEvent) => Promise<void>,
): Promise<ResumeOutcome> {
  if (!env.MORPH_API_KEY) {
    return "skipped";
  }

  const client = new MorphCloudClient({ apiKey: env.MORPH_API_KEY });

  const startingEvent: IframePreflightResumeEvent = {
    type: "resume",
    status: "starting",
    instanceId,
  };
  await send(startingEvent);

  for (let attempt = 1; attempt <= RESUME_MAX_ATTEMPTS; attempt += 1) {
    if (signal.aborted) {
      return "aborted";
    }

    const attemptEvent: IframePreflightResumeEvent = {
      type: "resume",
      status: "attempt",
      instanceId,
      attempt,
    };
    await send(attemptEvent);

    try {
      const instance = await client.instances.get({ instanceId });
      if (signal.aborted) {
        return "aborted";
      }
      await instance.resume();

      const successEvent: IframePreflightResumeEvent = {
        type: "resume",
        status: "success",
        instanceId,
        attempts: attempt,
      };
      await send(successEvent);
      return "success";
    } catch (error) {
      if (signal.aborted) {
        return "aborted";
      }

      const message = normalizeError(error);
      if (message.includes("HTTP 404")) {
        const notFoundEvent: IframePreflightResumeEvent = {
          type: "resume",
          status: "instance_not_found",
          instanceId,
        };
        await send(notFoundEvent);
        return "not_found";
      }

      if (attempt >= RESUME_MAX_ATTEMPTS) {
        const failedEvent: IframePreflightResumeEvent = {
          type: "resume",
          status: "failed",
          instanceId,
          attempts: attempt,
          error: message,
        };
        await send(failedEvent);
        return "failed";
      }

      const delayMs = RESUME_RETRY_BASE_DELAY_MS * attempt;
      await delay(delayMs, signal);
    }
  }

  return "failed";
}

async function performPreflight(
  target: URL,
  signal: AbortSignal,
): Promise<IframePreflightResultEvent> {
  const probe = async (method: "HEAD" | "GET") => {
    const response = await fetch(target, {
      method,
      redirect: "manual",
      signal,
    });
    await response.body?.cancel().catch(() => undefined);
    return response;
  };

  try {
    const headResponse = await probe("HEAD");

    if (headResponse.ok) {
      return {
        type: "preflight",
        ok: true,
        status: headResponse.status,
        method: "HEAD",
      };
    }

    if (headResponse.status === 405) {
      const getResponse = await probe("GET");
      if (getResponse.ok) {
        return {
          type: "preflight",
          ok: true,
          status: getResponse.status,
          method: "GET",
        };
      }

      return {
        type: "preflight",
        ok: false,
        status: getResponse.status,
        method: "GET",
        error: `Request failed with status ${getResponse.status}.`,
      };
    }

    return {
      type: "preflight",
      ok: false,
      status: headResponse.status,
      method: "HEAD",
      error: `Request failed with status ${headResponse.status}.`,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return {
      type: "preflight",
      ok: false,
      status: null,
      method: null,
      error: normalizeError(error),
    };
  }
}

const QuerySchema = z
  .object({
    url: z
      .string()
      .url()
      .openapi({
        description:
          "Absolute HTTP(S) URL to check before embedding in an iframe.",
      }),
  })
  .openapi("IframePreflightQuery");

const ResumeEventSchema = z
  .object({
    type: z.literal("resume"),
    instanceId: z.string(),
    status: z.enum([
      "starting",
      "attempt",
      "success",
      "failed",
      "instance_not_found",
    ]),
    attempt: z.number().int().positive().optional(),
    attempts: z.number().int().positive().optional(),
    error: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === "attempt" && value.attempt === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attempt count required when status is 'attempt'.",
        path: ["attempt"],
      });
    }
    if (value.status !== "attempt" && value.attempt !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attempt count only allowed when status is 'attempt'.",
        path: ["attempt"],
      });
    }
    if (
      (value.status === "success" || value.status === "failed") &&
      value.attempts === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attempts required when status is 'success' or 'failed'.",
        path: ["attempts"],
      });
    }
    if (
      value.status !== "success" &&
      value.status !== "failed" &&
      value.attempts !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attempts only allowed when status is 'success' or 'failed'.",
        path: ["attempts"],
      });
    }
    if (value.status === "failed" && value.error !== undefined && value.error.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Error message cannot be empty when status is 'failed'.",
        path: ["error"],
      });
    }
  });

const ResultEventSchema = z.object({
  type: z.literal("preflight"),
  ok: z.boolean(),
  status: z.number().int().min(0).max(599).nullable(),
  method: z.enum(["HEAD", "GET"]).nullable(),
  error: z.string().optional(),
});

const ErrorEventSchema = z.object({
  type: z.literal("error"),
  error: z.string(),
});

const StreamEventSchema = z
  .union([ResumeEventSchema, ResultEventSchema, ErrorEventSchema])
  .openapi("IframePreflightStreamEvent");

export const iframePreflightRouter = new OpenAPIHono();

iframePreflightRouter.openapi(
  createRoute({
    method: "get",
    path: "/iframe/preflight",
    tags: ["Iframe"],
    summary: "Validate iframe target availability and resume Morph instances if needed.",
    request: {
      query: QuerySchema,
    },
    responses: {
      200: {
        description: "Streamed status updates for the preflight check.",
        content: {
          "application/x-ndjson": {
            schema: StreamEventSchema,
          },
        },
      },
      400: {
        description: "The provided URL was not an HTTP(S) URL.",
      },
      403: {
        description: "The target host is not permitted for probing.",
      },
      401: {
        description: "Request is missing valid authentication.",
      },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.json(
        {
          ok: false,
          status: null,
          method: null,
          error: "Unauthorized",
        },
        401,
      );
    }

    const { url } = c.req.valid("query");
    const target = new URL(url);

    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return c.json(
        {
          ok: false,
          status: null,
          method: null,
          error: "Only HTTP(S) URLs are supported.",
        },
        400,
      );
    }

    if (target.username || target.password) {
      return c.json(
        {
          ok: false,
          status: null,
          method: null,
          error: "Authentication credentials in URL are not supported.",
        },
        400,
      );
    }

    if (!isAllowedHost(target.hostname)) {
      return c.json(
        {
          ok: false,
          status: null,
          method: null,
          error: `Requests to ${target.hostname} are not permitted.`,
        },
        403,
      );
    }

    const morphCandidate = parseMorphInstanceCandidate(target);

    c.header("content-type", "application/x-ndjson; charset=utf-8");

    return stream(c, async (streamApi) => {
      const abortController = new AbortController();
      let aborted = false;

      const send = async (event: IframePreflightStreamEvent) => {
        if (aborted) {
          return;
        }
        await streamApi.write(encodeIframePreflightStreamEvent(event));
      };

      streamApi.onAbort(() => {
        aborted = true;
        abortController.abort();
      });

      if (morphCandidate) {
        const outcome = await attemptResumeInstance(
          morphCandidate.instanceId,
          abortController.signal,
          send,
        );

        if (outcome === "aborted") {
          return;
        }

        if (outcome === "not_found") {
          await streamApi.close();
          return;
        }
      }

      try {
        const result = await performPreflight(target, abortController.signal);
        if (!aborted) {
          await send(result);
        }
      } catch (error) {
        if (!aborted && !isAbortError(error)) {
          await send({
            type: "error",
            error: normalizeError(error),
          });
        }
      } finally {
        if (!aborted && !streamApi.closed) {
          await streamApi.close();
        }
      }
    });
  },
);
