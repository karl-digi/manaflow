import type { FSWatcher } from "node:fs";

export function startKimiCompletionDetector(
  taskRunId: string
): Promise<void> {
  const markerPath = `/root/lifecycle/kimi-complete-${taskRunId}`;
  let watcher: FSWatcher | null = null;
  let stopped = false;

  return new Promise<void>((resolve, reject) => {
    void (async () => {
      try {
        const fs = await import("node:fs");
        const { watch, promises: fsp } = fs;

        const stop = () => {
          if (stopped) return;
          stopped = true;
          try {
            watcher?.close();
          } catch {
            // ignore
          }
          watcher = null;
        };

        try {
          await fsp.access(markerPath);
          if (!stopped) {
            stop();
            resolve();
            return;
          }
        } catch {
          // marker not created yet
        }

        watcher = watch(
          "/root/lifecycle",
          { persistent: false },
          (_event, filename) => {
            if (stopped) return;
            if (filename?.toString() === `kimi-complete-${taskRunId}`) {
              stop();
              resolve();
            }
          }
        );
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}
