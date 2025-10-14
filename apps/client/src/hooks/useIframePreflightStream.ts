import { useEffect, useRef, useState } from "react";

export type IframePreflightState =
  | { status: "loading" }
  | { status: "resuming-iframe"; attempt: number; maxAttempts: number }
  | { status: "iframe-ready" }
  | { status: "failed"; message: string }
  | { status: "instance-not-found" };

interface StreamEvent {
  type:
    | "status"
    | "resuming"
    | "resumed"
    | "ready"
    | "error"
    | "not_found";
  message?: string;
  attempt?: number;
  maxAttempts?: number;
}

interface UseIframePreflightStreamOptions {
  url: string;
  enabled?: boolean;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

export function useIframePreflightStream({
  url,
  enabled = true,
  onReady,
  onError,
}: UseIframePreflightStreamOptions): IframePreflightState {
  const [state, setState] = useState<IframePreflightState>({
    status: "loading",
  });
  const abortControllerRef = useRef<AbortController | null>(null);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);

  // Keep refs up to date
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!enabled || !url) {
      return;
    }

    setState({ status: "loading" });

    // Cancel any existing request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const runPreflightStream = async () => {
      try {
        const searchParams = new URLSearchParams({ url });
        const response = await fetch(
          `/api/iframe/preflight-stream?${searchParams.toString()}`,
          {
            method: "GET",
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
          },
        );

        if (controller.signal.aborted) {
          return;
        }

        if (!response.ok) {
          const error = new Error(
            `Preflight stream request failed (status ${response.status})`,
          );
          setState({
            status: "failed",
            message: error.message,
          });
          onErrorRef.current?.(error);
          return;
        }

        if (!response.body) {
          const error = new Error("Response body is null");
          setState({
            status: "failed",
            message: error.message,
          });
          onErrorRef.current?.(error);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          if (controller.signal.aborted) {
            reader.cancel();
            return;
          }

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE messages
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              try {
                const event: StreamEvent = JSON.parse(data);

                switch (event.type) {
                  case "status":
                    // Keep loading state
                    break;

                  case "resuming":
                    setState({
                      status: "resuming-iframe",
                      attempt: event.attempt ?? 1,
                      maxAttempts: event.maxAttempts ?? 3,
                    });
                    break;

                  case "resumed":
                    // Keep loading state, waiting for ready
                    setState({ status: "loading" });
                    break;

                  case "ready":
                    setState({ status: "iframe-ready" });
                    onReadyRef.current?.();
                    break;

                  case "error":
                    const errorMsg =
                      event.message ?? "Unknown error during preflight";
                    setState({
                      status: "failed",
                      message: errorMsg,
                    });
                    onErrorRef.current?.(new Error(errorMsg));
                    break;

                  case "not_found":
                    setState({ status: "instance-not-found" });
                    onErrorRef.current?.(
                      new Error("Instance not found"),
                    );
                    break;
                }
              } catch (parseError) {
                console.error("Failed to parse SSE data:", parseError);
              }
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        setState({
          status: "failed",
          message: errorMessage,
        });
        onErrorRef.current?.(
          error instanceof Error ? error : new Error(errorMessage),
        );
      }
    };

    void runPreflightStream();

    return () => {
      controller.abort();
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    };
  }, [enabled, url]);

  return state;
}
