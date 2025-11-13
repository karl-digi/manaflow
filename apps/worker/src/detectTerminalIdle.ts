import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { log } from "./logger";

interface IdleDetectionOptions {
  sessionName: string;
  idleTimeoutMs?: number;
  onIdle?: () => void;
  ignorePatterns?: RegExp[];
}

// Default patterns for common background noise
const DEFAULT_IGNORE_PATTERNS = [
  // Tmux status line updates (time, date, etc)
  /^\x1b\[\d+;\d+H/, // Cursor positioning sequences
  /^\x1b\]0;/, // Terminal title updates
  /^\x1b\[K/, // Clear to end of line
  /^\x07/, // Bell character
  // Empty or whitespace-only output
  /^\s*$/,
];

// Helper function to check if output should be ignored
function shouldIgnoreOutput(data: Buffer, ignorePatterns: RegExp[]): boolean {
  const str = data.toString();

  // Check each line of output
  const lines = str.split("\n");
  for (const line of lines) {
    // If any line doesn't match ignore patterns, it's real activity
    const shouldIgnoreLine = ignorePatterns.some((pattern) =>
      pattern.test(line)
    );
    if (line.length > 0 && !shouldIgnoreLine) {
      return false;
    }
  }

  // All lines matched ignore patterns
  return true;
}

// Helper function to check if tmux session exists
async function waitForTmuxSession(
  sessionName: string,
  maxRetries = 10,
  delayMs = 100
): Promise<void> {
  log(
    "DEBUG",
    `[detectTerminalIdle] Starting tmux session check for '${sessionName}'`,
    {
      maxRetries,
      delayMs,
    }
  );

  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await new Promise<boolean>((resolve) => {
        const checkProcess = spawn("tmux", ["has-session", "-t", sessionName]);

        checkProcess.on("exit", (code) => {
          log("DEBUG", `[detectTerminalIdle] Tmux has-session check exit`, {
            sessionName,
            attempt: i + 1,
            exitCode: code,
          });
          resolve(code === 0);
        });

        checkProcess.on("error", (error) => {
          log("DEBUG", `[detectTerminalIdle] Tmux has-session check error`, {
            sessionName,
            attempt: i + 1,
            error,
          });
          resolve(false);
        });
      });

      if (result) {
        log(
          "INFO",
          `[detectTerminalIdle] Tmux session '${sessionName}' is ready after ${i + 1} attempts`
        );
        return;
      }

      if (i < maxRetries - 1) {
        log(
          "DEBUG",
          `[detectTerminalIdle] Tmux session '${sessionName}' not ready, retrying in ${delayMs}ms... (attempt ${
            i + 1
          }/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } catch (error) {
      log("ERROR", `[detectTerminalIdle] Error checking tmux session`, {
        error,
        attempt: i + 1,
      });
    }
  }

  log(
    "ERROR",
    `[detectTerminalIdle] Tmux session '${sessionName}' not found after ${maxRetries} attempts`
  );
  throw new Error(
    `Tmux session '${sessionName}' not found after ${maxRetries} attempts`
  );
}

export async function detectTerminalIdle(
  options: IdleDetectionOptions
): Promise<{ elapsedMs: number }> {
  const {
    sessionName,
    idleTimeoutMs = 3000,
    onIdle,
    ignorePatterns = DEFAULT_IGNORE_PATTERNS,
  } = options;

  log("INFO", "[detectTerminalIdle] Starting terminal idle detection", {
    sessionName,
    idleTimeoutMs,
    hasOnIdleCallback: !!onIdle,
    ignorePatternsCount: ignorePatterns.length,
  });

  const startTime = Date.now();
  let lastActivityTime = Date.now();
  let idleDetected = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let maxRuntimeTimer: ReturnType<typeof setTimeout> | null = null;
  let child: ChildProcessWithoutNullStreams;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let detachCommandSentTime: number | null = null;

  return new Promise(async (resolve, reject) => {
    // Set a maximum timeout for the entire detection process
    const MAX_RUNTIME_MS = 20 * 60 * 1000; // 20 minutes max for any agent
    maxRuntimeTimer = setTimeout(() => {
      log(
        "WARNING",
        "[detectTerminalIdle] Maximum runtime reached, forcing completion",
        {
          sessionName,
          maxRuntimeMs: MAX_RUNTIME_MS,
          elapsedMs: Date.now() - startTime,
        }
      );

      if (!idleDetected) {
        idleDetected = true;
        if (onIdle) {
          try {
            onIdle();
          } catch (callbackError) {
            log("ERROR", "[detectTerminalIdle] onIdle callback failed", {
              sessionName,
              error: callbackError,
            });
          }
        }
        resolve({
          elapsedMs: Date.now() - startTime,
        });
      }
    }, MAX_RUNTIME_MS);

    // Poll tmux session to see if it's ready, retry up to 10 times with 100ms delay
    try {
      log(
        "DEBUG",
        "[detectTerminalIdle] Waiting for tmux session to be ready",
        { sessionName }
      );
      await waitForTmuxSession(sessionName);
      log("DEBUG", "[detectTerminalIdle] Tmux session is ready, proceeding", {
        sessionName,
      });
    } catch (error) {
      log("ERROR", "[detectTerminalIdle] Failed to find tmux session", {
        sessionName,
        error,
      });
      reject(error);
      return;
    }

    // wait for 5 seconds for stuff to be ready
    log(
      "DEBUG",
      "[detectTerminalIdle] Waiting 5 seconds for session to stabilize",
      { sessionName }
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
    log(
      "DEBUG",
      "[detectTerminalIdle] 5 second wait complete, starting process spawn",
      {
        sessionName,
      }
    );

    // Use 'script' command to allocate a PTY and attach to tmux session
    try {
      log(
        "DEBUG",
        "[detectTerminalIdle] Spawning script process to attach to tmux",
        {
          sessionName,
          command: `script -q -c "tmux attach-session -t ${sessionName}" /dev/null`,
        }
      );

      child = spawn(
        "script",
        ["-q", "-c", `tmux attach-session -t ${sessionName}`, "/dev/null"],
        {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, TERM: "xterm-256color" },
        }
      );

      log("DEBUG", "[detectTerminalIdle] Script process spawned successfully", {
        sessionName,
        pid: child.pid,
      });
    } catch (error) {
      log("ERROR", "[detectTerminalIdle] Failed to spawn script process", {
        sessionName,
        error,
      });
      reject(error);
      return;
    }

    const checkIdle = () => {
      const currentTime = Date.now();
      const timeSinceLastActivity = currentTime - lastActivityTime;
      const totalElapsed = currentTime - startTime;

      log("DEBUG", "[detectTerminalIdle] Checking idle status", {
        sessionName,
        timeSinceLastActivity,
        idleTimeoutMs,
        totalElapsed,
        idleDetected,
        isIdle: timeSinceLastActivity > idleTimeoutMs,
      });

      if (timeSinceLastActivity > idleTimeoutMs && !idleDetected) {
        const elapsedTime = Date.now() - startTime;
        log(
          "INFO",
          "[detectTerminalIdle] Terminal idle detected - triggering timeout",
          {
            sessionName,
            elapsedMs: elapsedTime,
            elapsedSeconds: (elapsedTime / 1000).toFixed(2),
            timeSinceLastActivity,
            idleTimeoutMs,
          }
        );

        idleDetected = true;

        // Detach from tmux (Ctrl+B, D)
        log(
          "DEBUG",
          "[detectTerminalIdle] Sending tmux detach sequence (Ctrl+B, D)",
          {
            sessionName,
          }
        );
        detachCommandSentTime = Date.now();
        child.stdin.write("\x02"); // Ctrl+B
        child.stdin.write("d"); // d for detach

        if (idleTimer) {
          log("DEBUG", "[detectTerminalIdle] Clearing idle timer", {
            sessionName,
          });
          clearTimeout(idleTimer);
        }

        if (maxRuntimeTimer) {
          clearTimeout(maxRuntimeTimer);
        }

        // Callback if provided
        if (onIdle) {
          log("DEBUG", "[detectTerminalIdle] Calling onIdle callback", {
            sessionName,
          });
          try {
            onIdle();
            log(
              "DEBUG",
              "[detectTerminalIdle] onIdle callback completed successfully",
              {
                sessionName,
              }
            );
          } catch (callbackError) {
            log("ERROR", "[detectTerminalIdle] onIdle callback failed", {
              sessionName,
              error: callbackError,
            });
          }
        }

        log(
          "INFO",
          "[detectTerminalIdle] Resolving with idle detection result",
          {
            sessionName,
            elapsedMs: elapsedTime,
          }
        );

        resolve({
          elapsedMs: elapsedTime,
        });
      } else {
        log(
          "DEBUG",
          "[detectTerminalIdle] Not idle yet, continuing monitoring",
          {
            sessionName,
            timeSinceLastActivity,
            idleTimeoutMs,
            remainingTime: idleTimeoutMs - timeSinceLastActivity,
          }
        );
      }
    };

    // Monitor stdout
    child.stdout.on("data", (data) => {
      const currentTime = Date.now();
      const timeSinceStart = currentTime - startTime;

      // Check if we're in the grace period after sending detach command
      const DETACH_GRACE_PERIOD_MS = 500; // 500ms grace period
      if (
        detachCommandSentTime &&
        currentTime - detachCommandSentTime < DETACH_GRACE_PERIOD_MS
      ) {
        log(
          "DEBUG",
          `[detectTerminalIdle] Ignoring stdout output during detach grace period`,
          {
            sessionName,
            bytes: data.length,
            timeSinceStart,
            timeSinceDetach: currentTime - detachCommandSentTime,
            dataPreview: data.toString().slice(0, 100).replace(/\n/g, "\\n"),
          }
        );
        return; // Don't reset idle timer during grace period
      }

      // Check if this output should be ignored
      const shouldIgnore = shouldIgnoreOutput(data, ignorePatterns);

      if (shouldIgnore) {
        log(
          "DEBUG",
          `[detectTerminalIdle] Ignoring stdout output (matches ignore patterns)`,
          {
            sessionName,
            bytes: data.length,
            timeSinceStart,
            dataPreview: data.toString().slice(0, 100).replace(/\n/g, "\\n"),
          }
        );
        return; // Don't reset idle timer for ignored output
      }

      // This is real user activity
      lastActivityTime = currentTime;

      log(
        "DEBUG",
        `[detectTerminalIdle] Real activity detected on stdout - resetting idle timer`,
        {
          sessionName,
          bytes: data.length,
          timeSinceStart,
          dataPreview: data.toString().slice(0, 100).replace(/\n/g, "\\n"),
        }
      );

      // Reset idle timer
      if (idleTimer) {
        log(
          "DEBUG",
          "[detectTerminalIdle] Clearing existing idle timer due to stdout activity",
          {
            sessionName,
          }
        );
        clearTimeout(idleTimer);
      }

      log(
        "DEBUG",
        "[detectTerminalIdle] Setting new idle timer after stdout activity",
        {
          sessionName,
          idleTimeoutMs,
        }
      );
      idleTimer = setTimeout(checkIdle, idleTimeoutMs);
    });

    // Monitor stderr
    child.stderr.on("data", (data) => {
      const currentTime = Date.now();
      const timeSinceStart = currentTime - startTime;

      // Check if we're in the grace period after sending detach command
      const DETACH_GRACE_PERIOD_MS = 500; // 500ms grace period
      if (
        detachCommandSentTime &&
        currentTime - detachCommandSentTime < DETACH_GRACE_PERIOD_MS
      ) {
        log(
          "DEBUG",
          `[detectTerminalIdle] Ignoring stderr output during detach grace period`,
          {
            sessionName,
            bytes: data.length,
            timeSinceStart,
            timeSinceDetach: currentTime - detachCommandSentTime,
            dataPreview: data.toString().slice(0, 100).replace(/\n/g, "\\n"),
          }
        );
        return; // Don't reset idle timer during grace period
      }

      // Check if this output should be ignored
      const shouldIgnore = shouldIgnoreOutput(data, ignorePatterns);

      if (shouldIgnore) {
        log(
          "DEBUG",
          `[detectTerminalIdle] Ignoring stderr output (matches ignore patterns)`,
          {
            sessionName,
            bytes: data.length,
            timeSinceStart,
            dataPreview: data.toString().slice(0, 100).replace(/\n/g, "\\n"),
          }
        );
        return; // Don't reset idle timer for ignored output
      }

      // This is real user activity
      lastActivityTime = currentTime;

      log(
        "DEBUG",
        `[detectTerminalIdle] Real activity detected on stderr - resetting idle timer`,
        {
          sessionName,
          bytes: data.length,
          timeSinceStart,
          dataPreview: data.toString().slice(0, 100).replace(/\n/g, "\\n"),
        }
      );

      // Reset idle timer
      if (idleTimer) {
        log(
          "DEBUG",
          "[detectTerminalIdle] Clearing existing idle timer due to stderr activity",
          {
            sessionName,
          }
        );
        clearTimeout(idleTimer);
      }

      log(
        "DEBUG",
        "[detectTerminalIdle] Setting new idle timer after stderr activity",
        {
          sessionName,
          idleTimeoutMs,
        }
      );
      idleTimer = setTimeout(checkIdle, idleTimeoutMs);
    });

    // Handle child process exit
    child.on("exit", (code, signal) => {
      const elapsedTime = Date.now() - startTime;

      log("INFO", `[detectTerminalIdle] Script process exited`, {
        sessionName,
        code,
        signal,
        elapsedTime,
        idleDetected,
      });

      if (idleTimer) {
        log(
          "DEBUG",
          "[detectTerminalIdle] Clearing idle timer due to process exit",
          {
            sessionName,
          }
        );
        clearTimeout(idleTimer);
      }

      if (maxRuntimeTimer) {
        clearTimeout(maxRuntimeTimer);
      }

      if (!idleDetected) {
        // Session ended before idle timeout
        // Only treat as completion if it ran for a reasonable amount of time AND exited cleanly
        const MIN_RUNTIME_MS = 30000; // Require at least 30 seconds of runtime

        if (elapsedTime < MIN_RUNTIME_MS) {
          log(
            "ERROR",
            "[detectTerminalIdle] Session ended too quickly - NOT marking as complete",
            {
              sessionName,
              elapsedTime,
              elapsedSeconds: (elapsedTime / 1000).toFixed(2),
              minRuntimeMs: MIN_RUNTIME_MS,
              exitCode: code,
            }
          );
          // Reject to indicate this was not a successful completion
          reject(
            new Error(
              `Terminal exited too quickly after ${elapsedTime}ms (min: ${MIN_RUNTIME_MS}ms)`
            )
          );
          return;
        }

        // Don't treat ANY exit as success if it happened too quickly
        // Even exit code 0 can mean the process failed to properly start
        log(
          "ERROR",
          "[detectTerminalIdle] Session exited without reaching idle state - NOT marking as complete",
          {
            sessionName,
            elapsedTime,
            elapsedSeconds: (elapsedTime / 1000).toFixed(2),
            exitCode: code,
            signal,
          }
        );
        // Reject to indicate this was not a successful completion
        reject(
          new Error(
            `Terminal exited prematurely with code ${code} after ${elapsedTime}ms - process likely failed to start properly`
          )
        );
        return;
      } else {
        log(
          "DEBUG",
          "[detectTerminalIdle] Process exited after idle was already detected",
          {
            sessionName,
          }
        );
      }
    });

    // Handle errors
    child.on("error", (err) => {
      const elapsedTime = Date.now() - startTime;

      log("ERROR", `[detectTerminalIdle] Script process error`, {
        sessionName,
        error: err,
        elapsedTime,
      });

      if (idleTimer) {
        log(
          "DEBUG",
          "[detectTerminalIdle] Clearing idle timer due to process error",
          {
            sessionName,
          }
        );
        clearTimeout(idleTimer);
      }
      reject(err);
    });

    // Start the idle timer
    log("DEBUG", "[detectTerminalIdle] Starting initial idle timer", {
      sessionName,
      idleTimeoutMs,
      startTime,
    });
    idleTimer = setTimeout(checkIdle, idleTimeoutMs);
  });
}
