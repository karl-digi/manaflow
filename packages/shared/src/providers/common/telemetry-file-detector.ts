import type { FSWatcher } from "node:fs";
import { createJsonStreamParser } from "./json-stream-parser";

export interface TelemetryFileDetectorOptions {
  /** Full path to the telemetry file */
  telemetryPath: string;
  /** Function to determine if an event signals completion */
  isCompletionEvent: (event: unknown) => boolean;
}

/**
 * Creates a completion detector that watches a telemetry file for completion events.
 * Used by Gemini and Qwen completion detectors.
 *
 * The detector:
 * - Watches for the telemetry file to be created (if not already present)
 * - Streams and parses JSON objects from the file
 * - Resolves when `isCompletionEvent` returns true for an event
 *
 * @returns A promise that resolves when a completion event is detected
 */
export function createTelemetryFileDetector(
  options: TelemetryFileDetectorOptions
): Promise<void> {
  const { telemetryPath, isCompletionEvent } = options;
  let fileWatcher: FSWatcher | null = null;
  let dirWatcher: FSWatcher | null = null;

  return new Promise<void>((resolve) => {
    void (async () => {
      const path = await import("node:path");
      const fs = await import("node:fs");
      const { watch, createReadStream, promises: fsp } = fs;

      let stopped = false;
      let lastSize = 0;

      const dir = path.dirname(telemetryPath);
      const file = path.basename(telemetryPath);

      const stop = () => {
        if (stopped) return;
        stopped = true;
        try {
          fileWatcher?.close();
        } catch (closeError) {
          console.error("[telemetry-file-detector] Error closing file watcher:", closeError);
        }
        try {
          dirWatcher?.close();
        } catch (closeError) {
          console.error("[telemetry-file-detector] Error closing directory watcher:", closeError);
        }
        resolve();
      };

      const parser = createJsonStreamParser((obj) => {
        if (stopped) return;
        if (isCompletionEvent(obj)) {
          stop();
        }
      });

      const readNew = async (initial = false) => {
        try {
          const st = await fsp.stat(telemetryPath);
          const start = initial ? 0 : lastSize;
          if (st.size <= start) {
            lastSize = st.size;
            return;
          }
          await new Promise<void>((r) => {
            const rs = createReadStream(telemetryPath, {
              start,
              end: st.size - 1,
              encoding: "utf-8",
            });
            rs.on("data", (chunk: string | Buffer) => {
              const text =
                typeof chunk === "string" ? chunk : chunk.toString("utf-8");
              parser(text);
            });
            rs.on("end", () => r());
            rs.on("error", () => r());
          });
          lastSize = st.size;
        } catch {
          // File may not exist yet; wait for watcher
        }
      };

      const attachFileWatcher = async () => {
        if (stopped) return;
        try {
          const st = await fsp.stat(telemetryPath);
          lastSize = st.size;
          await readNew(true);
          if (stopped) return;
          fileWatcher = watch(
            telemetryPath,
            { persistent: false, encoding: "utf8" },
            (eventType: string) => {
              if (!stopped && eventType === "change") {
                void readNew(false);
              }
            }
          );
        } catch {
          // File not present; wait for directory watcher
        }
      };

      dirWatcher = watch(
        dir,
        { persistent: false, encoding: "utf8" },
        (_eventType: string, filename: string | null) => {
          if (stopped) return;
          if (filename && filename.toString() === file) {
            void attachFileWatcher();
          }
        }
      );

      await attachFileWatcher();
    })();
  });
}
