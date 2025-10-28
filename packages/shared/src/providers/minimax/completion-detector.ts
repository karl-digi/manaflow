import type { FSWatcher } from "node:fs";

/**
 * Start watching for MiniMax task completion
 * Monitors for a completion marker file created when the task finishes
 * @param taskRunId - The unique identifier for this task run
 * @returns Promise that resolves when the task completes
 */
export function startMiniMaxCompletionDetector(
  taskRunId: string
): Promise<void> {
  const markerPath = `/root/lifecycle/minimax-complete-${taskRunId}`;
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
            // ignore errors when closing watcher
          }
          watcher = null;
        };

        // Check if marker file already exists
        try {
          await fsp.access(markerPath);
          if (!stopped) {
            stop();
            resolve();
            return;
          }
        } catch {
          // File doesn't exist yet, proceed to watch
        }

        // Watch for the marker file creation
        try {
          watcher = watch(
            "/root/lifecycle",
            { persistent: false },
            (_event, filename) => {
              if (stopped) return;
              if (filename?.toString() === `minimax-complete-${taskRunId}`) {
                stop();
                resolve();
              }
            }
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