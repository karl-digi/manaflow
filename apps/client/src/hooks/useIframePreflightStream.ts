import { useCallback, useEffect, useRef, useState } from "react";

import {
  isIframePreflightStreamEvent,
  type IframePreflightStreamEvent,
} from "@cmux/shared/morph-iframe-preflight";

export type IframePreflightPhase =
  | "idle"
  | "loading"
  | "resuming"
  | "ready"
  | "resume_failed"
  | "instance_not_found"
  | "error";

interface UseIframePreflightStreamOptions {
  url: string;
  enabled: boolean;
}

interface UseIframePreflightStreamResult {
  phase: IframePreflightPhase;
  error: string | null;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message) {
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
  return error instanceof DOMException && error.name === "AbortError";
}

function parseStreamLine(line: string): IframePreflightStreamEvent | null {
  if (!line) {
    return null;
  }
  try {
    const parsed = JSON.parse(line);
    return isIframePreflightStreamEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function useIframePreflightStream(
  options: UseIframePreflightStreamOptions,
): UseIframePreflightStreamResult {
  const { url, enabled } = options;
  const [phase, setPhase] = useState<IframePreflightPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const phaseRef = useRef<IframePreflightPhase>("idle");
  const abortRef = useRef<AbortController | null>(null);

  const commitState = useCallback((nextPhase: IframePreflightPhase, nextError: string | null) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
    setError(nextError);
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    if (!enabled || !url) {
      commitState("idle", null);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    commitState("loading", null);

    const run = async () => {
      try {
        const searchParams = new URLSearchParams({ url });
        const response = await fetch(
          `/api/iframe/preflight?${searchParams.toString()}`,
          {
            method: "GET",
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(
            `Preflight request failed (status ${response.status}) for iframe.`,
          );
        }

        if (!response.body) {
          throw new Error("Preflight response did not contain a body.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handleEvent = (event: IframePreflightStreamEvent) => {
          if (controller.signal.aborted) {
            return;
          }

          if (event.type === "resume") {
            if (event.status === "failed") {
              commitState(
                "resume_failed",
                event.error ?? "Failed to resume Morph instance.",
              );
              return;
            }

            if (event.status === "instance_not_found") {
              commitState(
                "instance_not_found",
                "Morph instance could not be found for this iframe.",
              );
              return;
            }

            if (
              event.status === "starting" ||
              event.status === "attempt" ||
              event.status === "success"
            ) {
              // Stay in resuming state until we get a definitive outcome.
              commitState("resuming", null);
            }
            return;
          }

          const currentPhase = phaseRef.current;
          if (currentPhase === "resume_failed" || currentPhase === "instance_not_found") {
            return;
          }

          if (event.type === "preflight") {
            if (event.ok) {
              commitState("ready", null);
            } else {
              const reason =
                event.error ??
                (event.status !== null
                  ? `Preflight failed (status ${event.status}).`
                  : "Preflight failed.");
              commitState("error", reason);
            }
            return;
          }

          if (event.type === "error") {
            commitState("error", event.error);
          }
        };

        const processBuffer = () => {
          while (true) {
            const newlineIndex = buffer.indexOf("\n");
            if (newlineIndex === -1) {
              break;
            }
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            const event = parseStreamLine(line);
            if (event) {
              handleEvent(event);
            }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          processBuffer();
        }

        buffer += decoder.decode();
        processBuffer();

        // If we never received a terminal event, treat the stream as failed.
        if (
          phaseRef.current !== "ready" &&
          phaseRef.current !== "resume_failed" &&
          phaseRef.current !== "instance_not_found" &&
          phaseRef.current !== "error"
        ) {
          commitState("error", "Preflight stream ended unexpectedly.");
        }
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          return;
        }
        commitState("error", normalizeError(error));
      }
    };

    void run();

    return () => {
      controller.abort();
    };
  }, [commitState, enabled, url]);

  return { phase, error };
}
