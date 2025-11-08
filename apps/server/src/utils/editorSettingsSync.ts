import type { Id } from "@cmux/convex/dataModel";
import { connectToWorkerManagement } from "@cmux/shared/socket";
import type { WorkerCreateTerminal } from "@cmux/shared/worker-schemas";
import { env } from "./server-env";
import { serverLogger } from "./fileLogger";
import { getEditorSettingsUpload } from "./editorSettings";

interface SyncEditorSettingsOptions {
  workerUrl: string | null | undefined;
  taskRunId: Id<"taskRuns">;
  taskRunJwt?: string | null;
  prompt?: string;
  context?: string;
}

const CONNECT_TIMEOUT_MS = 30_000;

function sanitizeTerminalId(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return sanitized.length > 0 ? sanitized : "cmux-editor-sync";
}

export async function syncEditorSettingsToWorker(
  options: SyncEditorSettingsOptions
): Promise<void> {
  const { workerUrl, taskRunId, taskRunJwt, prompt, context } = options;
  const contextLabel = context ?? "cloud-workspace";

  if (!workerUrl) {
    serverLogger.warn(
      `[EditorSettingsSync] ${contextLabel} ${taskRunId}: missing worker URL; skipping`
    );
    return;
  }

  const editorSettings = await getEditorSettingsUpload();
  if (!editorSettings || editorSettings.authFiles.length === 0) {
    serverLogger.info(
      `[EditorSettingsSync] ${contextLabel} ${taskRunId}: no local editor settings detected`
    );
    return;
  }

  if (!taskRunJwt) {
    serverLogger.warn(
      `[EditorSettingsSync] ${contextLabel} ${taskRunId}: missing taskRun JWT; cannot push editor settings`
    );
    return;
  }

  const terminalId = sanitizeTerminalId(
    `cmux-editor-sync-${String(taskRunId)}`
  );
  const syncPrompt = prompt ?? "Sync VSCode settings and extensions";

  serverLogger.info(
    `[EditorSettingsSync] ${contextLabel} ${taskRunId}: pushing ${editorSettings.authFiles.length} file(s) to worker ${workerUrl}`
  );

  await new Promise<void>((resolve, reject) => {
    const socket = connectToWorkerManagement({
      url: workerUrl,
      timeoutMs: CONNECT_TIMEOUT_MS,
      reconnectionAttempts: 5,
      forceNew: true,
    });

    let completed = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (error?: Error) => {
      if (completed) {
        return;
      }
      completed = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleError);
      socket.off("error", handleError);
      socket.disconnect();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    timeout = setTimeout(() => {
      finish(new Error("Timed out connecting to worker for editor settings sync"));
    }, CONNECT_TIMEOUT_MS);

    const handleError = (rawError: unknown) => {
      const error =
        rawError instanceof Error
          ? rawError
          : new Error(String(rawError ?? "Unknown connection error"));
      finish(error);
    };

    const handleConnect = () => {
      const payload: WorkerCreateTerminal = {
        terminalId,
        cols: 80,
        rows: 24,
        cwd: "/root/workspace",
        env: {},
        command: "bash",
        args: ["-lc", "echo 'cmux editor settings synced'"],
        taskRunContext: {
          taskRunToken: taskRunJwt,
          prompt: syncPrompt,
          convexUrl: env.NEXT_PUBLIC_CONVEX_URL,
        },
        taskRunId,
        authFiles: editorSettings.authFiles,
        startupCommands: editorSettings.startupCommands,
        agentModel: contextLabel,
      };

      socket.emit("worker:create-terminal", payload, (result) => {
        if (result.error) {
          const error =
            result.error instanceof Error
              ? result.error
              : new Error(
                  result.error?.message ||
                    "Worker rejected editor settings sync request"
                );
          finish(error);
          return;
        }

        serverLogger.info(
          `[EditorSettingsSync] ${contextLabel} ${taskRunId}: worker accepted editor sync request`
        );
        finish();
      });
    };

    socket.on("connect", handleConnect);
    socket.on("connect_error", handleError);
    socket.on("error", handleError);
  });

  serverLogger.info(
    `[EditorSettingsSync] ${contextLabel} ${taskRunId}: editor settings sync completed`
  );
}
