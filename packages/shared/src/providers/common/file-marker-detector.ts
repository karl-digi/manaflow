import type { FSWatcher } from "node:fs";

export interface FileMarkerDetectorOptions {
  /** Full path to the marker file */
  markerPath: string;
  /** Directory to watch for the marker file creation */
  watchDir: string;
  /** Filename of the marker (basename of markerPath) */
  markerFilename: string;
  /** Optional callback when marker is detected */
  onComplete?: () => void;
}

/**
 * Creates a completion detector that watches for a marker file to be created.
 * Used by Claude, OpenCode, and Codex completion detectors.
 *
 * @returns A promise that resolves when the marker file is detected
 */
export function createFileMarkerDetector(
  options: FileMarkerDetectorOptions
): Promise<void> {
  const { markerPath, watchDir, markerFilename, onComplete } = options;
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
            // ignore close errors
          }
          watcher = null;
        };

        // Check if marker already exists
        try {
          await fsp.access(markerPath);
          if (!stopped) {
            stop();
            onComplete?.();
            resolve();
            return;
          }
        } catch {
          // Marker not present yet, continue to watch
        }

        // Ensure watch directory exists
        try {
          await fsp.mkdir(watchDir, { recursive: true });
        } catch {
          // Directory may already exist
        }

        // Watch for marker file creation
        try {
          watcher = watch(
            watchDir,
            { persistent: false },
            (_event, filename) => {
              if (stopped) return;
              if (filename?.toString() === markerFilename) {
                stop();
                onComplete?.();
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
