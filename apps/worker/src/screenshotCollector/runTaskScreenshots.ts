import type { ScreenshotUploadPayload } from "@cmux/shared";
import type { Id } from "@cmux/convex/dataModel";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { log } from "../logger";
import { startScreenshotCollection } from "./startScreenshotCollection";
import { createScreenshotUploadUrl, uploadScreenshot } from "./upload";
import {
  startVideoRecording,
  stopVideoRecording,
  isFFmpegAvailable,
  type ActiveRecording,
  type VideoRecordingResult,
} from "./videoRecorder";

export interface RunTaskScreenshotsOptions {
  taskId: Id<"tasks">;
  taskRunId: Id<"taskRuns">;
  token: string;
  convexUrl?: string;
  anthropicApiKey?: string | null;
  taskRunJwt?: string | null;
  /** Command to install dependencies (e.g., "bun install") */
  installCommand?: string | null;
  /** Command to start the dev server (e.g., "bun run dev") */
  devCommand?: string | null;
}

function resolveContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  // Image types
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".png") {
    return "image/png";
  }
  // Video types
  if (extension === ".mp4") {
    return "video/mp4";
  }
  if (extension === ".webm") {
    return "video/webm";
  }
  if (extension === ".mov") {
    return "video/quicktime";
  }
  // Default to png for unknown image types
  return "image/png";
}

function resolveMediaType(contentType: string): "image" | "video" {
  return contentType.startsWith("video/") ? "video" : "image";
}

async function uploadMediaFile(params: {
  mediaPath: string;
  fileName?: string;
  commitSha: string;
  token: string;
  convexUrl?: string;
  description?: string;
  /** Duration in milliseconds (for videos) */
  durationMs?: number;
}): Promise<NonNullable<ScreenshotUploadPayload["images"]>[number]> {
  const { mediaPath, fileName, commitSha, token, convexUrl, description, durationMs } =
    params;
  const resolvedFileName = fileName ?? path.basename(mediaPath);
  const contentType = resolveContentType(mediaPath);
  const mediaType = resolveMediaType(contentType);

  const uploadUrl = await createScreenshotUploadUrl({
    token,
    baseUrlOverride: convexUrl,
    contentType,
  });

  const bytes = await fs.readFile(mediaPath);
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
    },
    body: new Uint8Array(bytes),
  });

  if (!uploadResponse.ok) {
    const body = await uploadResponse.text();
    throw new Error(
      `Upload failed with status ${uploadResponse.status}: ${body}`
    );
  }

  const uploadResult = (await uploadResponse.json()) as {
    storageId?: string;
  };
  if (!uploadResult.storageId) {
    throw new Error("Upload response missing storageId");
  }

  return {
    storageId: uploadResult.storageId,
    mimeType: contentType,
    fileName: resolvedFileName,
    commitSha,
    description,
    mediaType,
    durationMs,
  };
}

export async function runTaskScreenshots(
  options: RunTaskScreenshotsOptions
): Promise<void> {
  const { taskId, taskRunId, token, convexUrl, anthropicApiKey } = options;
  const taskRunJwt = options.taskRunJwt ?? token;

  log("INFO", "Starting automated screenshot workflow", {
    taskId,
    taskRunId,
    hasAnthropicKey: Boolean(anthropicApiKey ?? process.env.ANTHROPIC_API_KEY),
  });

  const result = await startScreenshotCollection({
    anthropicApiKey: anthropicApiKey ?? undefined,
    taskRunJwt,
    convexUrl,
    installCommand: options.installCommand,
    devCommand: options.devCommand,
  });

  let images: ScreenshotUploadPayload["images"];
  let hasUiChanges: boolean | undefined;
  let status: ScreenshotUploadPayload["status"] = "failed";
  let error: string | undefined;
  let commitSha: string | undefined;

  if (result.status === "completed") {
    commitSha = result.commitSha;
    const capturedScreens = result.screenshots ?? [];
    hasUiChanges = result.hasUiChanges;
    if (capturedScreens.length === 0) {
      status = "failed";
      error = "Claude collector returned no screenshots";
      log("ERROR", error, { taskRunId });
    } else {
      const uploadPromises = capturedScreens.map((screenshot) =>
        uploadMediaFile({
          mediaPath: screenshot.path,
          fileName: screenshot.fileName,
          commitSha: result.commitSha,
          token,
          convexUrl,
          description: screenshot.description,
        })
      );

      const settledUploads = await Promise.allSettled(uploadPromises);
      const successfulScreens: NonNullable<ScreenshotUploadPayload["images"]> =
        [];
      const failures: { index: number; reason: string }[] = [];

      settledUploads.forEach((settled, index) => {
        if (settled.status === "fulfilled") {
          successfulScreens.push(settled.value);
        } else {
          const reason =
            settled.reason instanceof Error
              ? settled.reason.message
              : String(settled.reason);
          failures.push({ index, reason });
          log("ERROR", "Failed to upload screenshot", {
            taskRunId,
            screenshotPath: capturedScreens[index]?.path,
            error: reason,
          });
        }
      });

      if (failures.length === 0) {
        images = successfulScreens;
        status = "completed";
        log("INFO", "Screenshots uploaded", {
          taskRunId,
          screenshotCount: successfulScreens.length,
          commitSha: result.commitSha,
        });
      } else {
        status = "failed";
        error =
          failures.length === 1
            ? failures[0]?.reason
            : `Failed to upload ${failures.length} screenshots`;
      }
    }
  } else if (result.status === "skipped") {
    status = "skipped";
    error = result.reason;
    commitSha = result.commitSha;
    hasUiChanges = result.hasUiChanges;
    log("INFO", "Screenshot workflow skipped", {
      taskRunId,
      reason: result.reason,
    });
  } else if (result.status === "failed") {
    status = "failed";
    error = result.error;
    commitSha = result.commitSha;
    hasUiChanges = result.hasUiChanges;
    log("ERROR", "Screenshot workflow failed", {
      taskRunId,
      error: result.error,
    });
  } else {
    status = "failed";
    error = "Unknown screenshot workflow result";
    log("ERROR", "Screenshot workflow returned unknown status", {
      taskRunId,
      result,
    });
  }
  // For completed status, commitSha is required
  if (status === "completed" && !commitSha) {
    log("ERROR", "Cannot upload completed screenshot result without commitSha", {
      taskRunId,
      status,
      error,
    });
    return;
  }

  await uploadScreenshot({
    token,
    baseUrlOverride: convexUrl,
    payload: {
      taskId,
      runId: taskRunId,
      status,
      // Only include commitSha if available (required for completed, optional for failed/skipped)
      ...(commitSha && { commitSha }),
      images,
      error,
      hasUiChanges,
    },
  });
}

/**
 * Options for uploading a video to a task run
 */
export interface UploadVideoOptions {
  taskId: Id<"tasks">;
  taskRunId: Id<"taskRuns">;
  token: string;
  convexUrl?: string;
  /** Video recording result from stopVideoRecording() */
  video: VideoRecordingResult;
  /** Git commit SHA for the video */
  commitSha: string;
}

/**
 * Uploads a video recording to a task run's screenshot set.
 * The video will be added as a media item alongside any existing screenshots.
 */
export async function uploadTaskVideo(
  options: UploadVideoOptions
): Promise<void> {
  const { taskId, taskRunId, token, convexUrl, video, commitSha } = options;

  log("INFO", "Uploading video to task run", {
    taskId,
    taskRunId,
    videoPath: video.path,
    durationMs: video.durationMs,
  });

  try {
    const uploadedMedia = await uploadMediaFile({
      mediaPath: video.path,
      fileName: video.fileName,
      commitSha,
      token,
      convexUrl,
      description: video.description,
      durationMs: video.durationMs,
    });

    await uploadScreenshot({
      token,
      baseUrlOverride: convexUrl,
      payload: {
        taskId,
        runId: taskRunId,
        status: "completed",
        commitSha,
        images: [uploadedMedia],
      },
    });

    log("INFO", "Video uploaded successfully", {
      taskId,
      taskRunId,
      storageId: uploadedMedia.storageId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("ERROR", "Failed to upload video", {
      taskId,
      taskRunId,
      error: message,
    });
    throw error;
  }
}

// Re-export video recording functions for convenience
export {
  startVideoRecording,
  stopVideoRecording,
  isFFmpegAvailable,
  type ActiveRecording,
  type VideoRecordingResult,
};
