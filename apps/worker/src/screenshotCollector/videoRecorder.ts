import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { log } from "../logger";
import { logToScreenshotCollector } from "./logger";

export interface VideoRecordingOptions {
  /** Output directory for the video file */
  outputDir?: string;
  /** Video filename (without extension). Defaults to timestamp-based name */
  fileName?: string;
  /** Frame rate for recording. Defaults to 30 */
  frameRate?: number;
  /** X11 display to capture. Defaults to :99 */
  display?: string;
  /** Video resolution. Defaults to 1920x1080 */
  resolution?: string;
  /** Description of the video content */
  description?: string;
}

export interface VideoRecordingResult {
  /** Absolute path to the recorded video file */
  path: string;
  /** Video filename */
  fileName: string;
  /** Video duration in milliseconds */
  durationMs: number;
  /** MIME type of the video */
  mimeType: string;
  /** Description of the video content */
  description?: string;
}

export interface ActiveRecording {
  /** The ffmpeg process */
  process: ChildProcess;
  /** Path to the output file */
  outputPath: string;
  /** Filename of the output */
  fileName: string;
  /** When recording started */
  startTime: number;
  /** Description of the video */
  description?: string;
}

const VIDEO_STORAGE_ROOT = path.join(os.tmpdir(), "cmux-video-recordings");

/**
 * Checks if ffmpeg is available on the system
 */
export async function isFFmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.on("error", () => {
      resolve(false);
    });

    proc.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

/**
 * Gets the video duration in milliseconds using ffprobe
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        videoPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const seconds = parseFloat(stdout.trim());
        if (!isNaN(seconds)) {
          resolve(Math.round(seconds * 1000));
        } else {
          reject(new Error(`Failed to parse video duration: ${stdout}`));
        }
      } else {
        reject(new Error(`ffprobe failed with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Starts recording the screen using ffmpeg.
 * Returns an ActiveRecording handle that can be used to stop the recording.
 */
export async function startVideoRecording(
  options: VideoRecordingOptions = {}
): Promise<ActiveRecording> {
  const {
    outputDir = VIDEO_STORAGE_ROOT,
    fileName = `recording-${Date.now()}`,
    frameRate = 30,
    display = process.env.DISPLAY || ":99",
    resolution = "1920x1080",
    description,
  } = options;

  // Check if ffmpeg is available
  const ffmpegAvailable = await isFFmpegAvailable();
  if (!ffmpegAvailable) {
    throw new Error("ffmpeg is not available on this system");
  }

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `${fileName}.mp4`);

  await logToScreenshotCollector(`Starting video recording to ${outputPath}`);
  log("INFO", "Starting video recording", {
    outputPath,
    frameRate,
    display,
    resolution,
  });

  // Start ffmpeg recording
  // Using x11grab for X11 screen capture
  const ffmpegArgs = [
    "-y", // Overwrite output file
    "-f",
    "x11grab", // X11 screen capture
    "-video_size",
    resolution,
    "-framerate",
    String(frameRate),
    "-i",
    display, // X11 display
    "-c:v",
    "libx264", // H.264 codec
    "-preset",
    "ultrafast", // Fast encoding for real-time
    "-crf",
    "23", // Quality (lower = better, 23 is default)
    "-pix_fmt",
    "yuv420p", // Pixel format for compatibility
    outputPath,
  ];

  const ffmpegProcess = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  });

  let stderrOutput = "";
  ffmpegProcess.stderr?.on("data", (data) => {
    stderrOutput += data.toString();
  });

  // Handle process errors
  ffmpegProcess.on("error", (err) => {
    log("ERROR", "ffmpeg process error", { error: err.message });
  });

  // Wait a moment to ensure ffmpeg has started
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Check if process is still running
  if (ffmpegProcess.exitCode !== null) {
    throw new Error(`ffmpeg exited immediately: ${stderrOutput}`);
  }

  await logToScreenshotCollector("Video recording started successfully");
  log("INFO", "Video recording started", { outputPath, pid: ffmpegProcess.pid });

  return {
    process: ffmpegProcess,
    outputPath,
    fileName: `${fileName}.mp4`,
    startTime: Date.now(),
    description,
  };
}

/**
 * Stops an active video recording and returns the result.
 */
export async function stopVideoRecording(
  recording: ActiveRecording
): Promise<VideoRecordingResult> {
  const { process: ffmpegProcess, outputPath, fileName, startTime, description } = recording;

  await logToScreenshotCollector("Stopping video recording...");
  log("INFO", "Stopping video recording", { outputPath, pid: ffmpegProcess.pid });

  // Send 'q' to ffmpeg stdin to gracefully stop recording
  return new Promise((resolve, reject) => {
    let resolved = false;

    const handleExit = async (code: number | null) => {
      if (resolved) return;
      resolved = true;

      if (code !== 0 && code !== 255) {
        // 255 is expected when we send 'q'
        reject(new Error(`ffmpeg exited with code ${code}`));
        return;
      }

      try {
        // Wait a moment for the file to be finalized
        await new Promise((r) => setTimeout(r, 500));

        // Verify the file exists
        await fs.access(outputPath);

        // Get video duration
        let durationMs: number;
        try {
          durationMs = await getVideoDuration(outputPath);
        } catch (durationError) {
          // Fallback to elapsed time if ffprobe fails
          durationMs = Date.now() - startTime;
          log("WARN", "Failed to get video duration from ffprobe, using elapsed time", {
            error: durationError instanceof Error ? durationError.message : String(durationError),
            fallbackDurationMs: durationMs,
          });
        }

        await logToScreenshotCollector(
          `Video recording stopped: ${outputPath} (${Math.round(durationMs / 1000)}s)`
        );
        log("INFO", "Video recording stopped", {
          outputPath,
          durationMs,
        });

        resolve({
          path: outputPath,
          fileName,
          durationMs,
          mimeType: "video/mp4",
          description,
        });
      } catch (err) {
        reject(err);
      }
    };

    ffmpegProcess.on("close", handleExit);
    ffmpegProcess.on("exit", handleExit);

    // Try to gracefully stop ffmpeg
    if (ffmpegProcess.stdin?.writable) {
      ffmpegProcess.stdin.write("q");
      ffmpegProcess.stdin.end();
    } else {
      // If stdin is not available, send SIGINT
      ffmpegProcess.kill("SIGINT");
    }

    // Force kill after timeout
    setTimeout(() => {
      if (!resolved) {
        log("WARN", "Force killing ffmpeg process after timeout");
        ffmpegProcess.kill("SIGKILL");
      }
    }, 5000);
  });
}

/**
 * Records a video for a specified duration.
 * This is a convenience function that starts recording, waits, and stops.
 */
export async function recordVideo(
  options: VideoRecordingOptions & { durationSeconds: number }
): Promise<VideoRecordingResult> {
  const { durationSeconds, ...recordingOptions } = options;

  const recording = await startVideoRecording(recordingOptions);

  await logToScreenshotCollector(`Recording for ${durationSeconds} seconds...`);

  // Wait for the specified duration
  await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));

  return stopVideoRecording(recording);
}
