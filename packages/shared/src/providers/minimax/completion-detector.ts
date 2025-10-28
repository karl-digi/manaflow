import type { FSWatcher } from "node:fs";

export function startMinimaxCompletionDetector(
  taskRunId: string,
): Promise<void> {
  const markerPath = `/root/lifecycle/claude-complete-${taskRunId}`;
  let watcher: FSWatcher | null = null;
  let stopped = false;

  return new Promise<void>((resolve, reject) => {
    void (async () => {
      try {
        const fs = await import("node:fs");
        const { watch, promises: fsp } = fs;

        const stop = () => {
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
          // not there yet
        }

        try {
          watcher = watch(
            "/root/lifecycle",
            { persistent: false },
            (_event, filename) => {
              if (stopped) return;
              if (filename?.toString() === `claude-complete-${taskRunId}`) {
                stop();
                resolve();
              }
            },
          );
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  });
}
