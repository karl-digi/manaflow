import type {
  ServerToWorkerEvents,
  WorkerToServerEvents,
  WorkerUploadFiles,
} from "@cmux/shared";
import type { Socket } from "@cmux/shared/socket";

export async function workerUploadFiles({
  workerSocket,
  payload,
  timeout = 30_000,
}: {
  workerSocket: Socket<WorkerToServerEvents, ServerToWorkerEvents>;
  payload: WorkerUploadFiles;
  timeout?: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      workerSocket
        .timeout(timeout)
        .emit("worker:upload-files", payload, (error, result) => {
          if (error) {
            if (error instanceof Error && error.message === "operation has timed out") {
              reject(new Error(`File upload timed out after ${timeout}ms`));
            } else {
              reject(error);
            }
            return;
          }
          if (result.error) {
            reject(result.error);
            return;
          }
          resolve();
        });
    } catch (err) {
      reject(err);
    }
  });
}
