import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { logToScreenshotCollector } from "./logger";

export interface VideoRecorderOptions {
  /** Output directory for the video file */
  outputDir: string;
  /** Optional filename for the video (default: session-recording.webm) */
  fileName?: string;
  /** Frame rate for the video (default: 2 fps for reasonable file size) */
  frameRate?: number;
  /** CDP endpoint URL (default: http://0.0.0.0:39382) */
  cdpEndpoint?: string;
}

export interface VideoRecordingResult {
  path: string;
  fileName: string;
  mimeType: string;
  durationMs: number;
  description: string;
}

interface ScreencastFrame {
  data: string; // base64 encoded image
  metadata: {
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
    timestamp?: number;
  };
  sessionId: number;
}

/**
 * VideoRecorder captures browser session as a video using CDP's Page.startScreencast.
 *
 * This class:
 * 1. Connects to Chrome via CDP
 * 2. Starts screencast to capture frames
 * 3. Saves frames to a temp directory
 * 4. Uses ffmpeg to convert frames to a video file
 */
export class VideoRecorder {
  private outputDir: string;
  private fileName: string;
  private frameRate: number;
  private cdpEndpoint: string;
  private framesDir: string;
  private frameCount: number = 0;
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private isRecording: boolean = false;
  private startTime: number = 0;
  private messageId: number = 1;

  constructor(options: VideoRecorderOptions) {
    this.outputDir = options.outputDir;
    this.fileName = options.fileName ?? "session-recording.webm";
    this.frameRate = options.frameRate ?? 2;
    this.cdpEndpoint = options.cdpEndpoint ?? "http://0.0.0.0:39382";
    this.framesDir = path.join(this.outputDir, ".video-frames");
  }

  private async sendCdpCommand(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const id = this.messageId++;
      const message = JSON.stringify({ id, method, params });

      const handler = (event: MessageEvent) => {
        const response = JSON.parse(String(event.data));
        if (response.id === id) {
          this.ws?.removeEventListener("message", handler);
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response.result);
          }
        }
      };

      this.ws.addEventListener("message", handler);
      this.ws.send(message);

      // Timeout after 10 seconds
      setTimeout(() => {
        this.ws?.removeEventListener("message", handler);
        reject(new Error(`CDP command ${method} timed out`));
      }, 10000);
    });
  }

  private async getWebSocketUrl(): Promise<string> {
    const response = await fetch(`${this.cdpEndpoint}/json/version`);
    if (!response.ok) {
      throw new Error(`Failed to get CDP version: ${response.statusText}`);
    }
    const data = await response.json() as { webSocketDebuggerUrl: string };
    return data.webSocketDebuggerUrl;
  }

  private async connectToCdp(): Promise<void> {
    const wsUrl = await this.getWebSocketUrl();
    await logToScreenshotCollector(`[VideoRecorder] Connecting to CDP: ${wsUrl}`);

    this.ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("WebSocket not initialized"));
        return;
      }

      this.ws.onopen = () => {
        resolve();
      };

      this.ws.onerror = (error) => {
        reject(new Error(`WebSocket error: ${error}`));
      };

      // Timeout after 10 seconds
      setTimeout(() => reject(new Error("WebSocket connection timeout")), 10000);
    });

    await logToScreenshotCollector("[VideoRecorder] Connected to CDP");
  }

  private async handleScreencastFrame(frame: ScreencastFrame): Promise<void> {
    if (!this.isRecording) return;

    const frameNumber = this.frameCount++;
    const framePath = path.join(this.framesDir, `frame-${String(frameNumber).padStart(6, "0")}.png`);

    // Decode base64 and save frame
    const buffer = Buffer.from(frame.data, "base64");
    await fs.writeFile(framePath, buffer);

    // Acknowledge the frame
    await this.sendCdpCommand("Page.screencastFrameAck", { sessionId: frame.sessionId });
  }

  async start(): Promise<void> {
    if (this.isRecording) {
      await logToScreenshotCollector("[VideoRecorder] Already recording");
      return;
    }

    await logToScreenshotCollector("[VideoRecorder] Starting video recording...");

    // Create frames directory
    await fs.mkdir(this.framesDir, { recursive: true });

    try {
      await this.connectToCdp();
    } catch (error) {
      await logToScreenshotCollector(`[VideoRecorder] Failed to connect to CDP: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    // Set up frame handler
    if (this.ws) {
      this.ws.addEventListener("message", async (event) => {
        const message = JSON.parse(String(event.data));
        if (message.method === "Page.screencastFrame") {
          await this.handleScreencastFrame(message.params as ScreencastFrame);
        }
      });
    }

    // Enable Page domain and start screencast
    await this.sendCdpCommand("Page.enable");
    await this.sendCdpCommand("Page.startScreencast", {
      format: "png",
      quality: 80,
      maxWidth: 1920,
      maxHeight: 1080,
      everyNthFrame: Math.max(1, Math.round(60 / this.frameRate)), // Assuming 60fps browser, capture every Nth frame
    });

    this.isRecording = true;
    this.startTime = Date.now();
    await logToScreenshotCollector(`[VideoRecorder] Recording started at ${this.frameRate} fps`);
  }

  async stop(): Promise<VideoRecordingResult | null> {
    if (!this.isRecording) {
      await logToScreenshotCollector("[VideoRecorder] Not recording");
      return null;
    }

    const durationMs = Date.now() - this.startTime;
    await logToScreenshotCollector(`[VideoRecorder] Stopping recording after ${durationMs}ms, ${this.frameCount} frames captured`);

    this.isRecording = false;

    // Stop screencast
    try {
      await this.sendCdpCommand("Page.stopScreencast");
    } catch (error) {
      await logToScreenshotCollector(`[VideoRecorder] Warning: Failed to stop screencast: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // If no frames captured, return null
    if (this.frameCount === 0) {
      await logToScreenshotCollector("[VideoRecorder] No frames captured, skipping video creation");
      await this.cleanup();
      return null;
    }

    // Convert frames to video using ffmpeg
    const outputPath = path.join(this.outputDir, this.fileName);

    try {
      await this.convertFramesToVideo(outputPath, durationMs);
      await logToScreenshotCollector(`[VideoRecorder] Video saved to ${outputPath}`);

      return {
        path: outputPath,
        fileName: this.fileName,
        mimeType: "video/webm",
        durationMs,
        description: "Session recording of the screenshot collection process",
      };
    } catch (error) {
      await logToScreenshotCollector(`[VideoRecorder] Failed to create video: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      await this.cleanup();
    }
  }

  private async convertFramesToVideo(outputPath: string, durationMs: number): Promise<void> {
    await logToScreenshotCollector(`[VideoRecorder] Converting ${this.frameCount} frames to video...`);

    // Calculate actual frame rate based on captured frames and duration
    const actualFps = this.frameCount / (durationMs / 1000);
    const inputFps = Math.max(1, Math.min(actualFps, 30)); // Clamp between 1 and 30 fps

    return new Promise((resolve, reject) => {
      const ffmpegArgs = [
        "-y", // Overwrite output file
        "-framerate", String(inputFps),
        "-i", path.join(this.framesDir, "frame-%06d.png"),
        "-c:v", "libvpx-vp9", // VP9 codec for webm
        "-crf", "30", // Quality (lower = better, 30 is good for reasonable size)
        "-b:v", "0", // Variable bitrate mode
        "-pix_fmt", "yuva420p", // Pixel format
        outputPath,
      ];

      const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stderr = "";

      ffmpeg.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        }
      });

      ffmpeg.on("error", (error) => {
        reject(new Error(`ffmpeg error: ${error.message}`));
      });
    });
  }

  private async cleanup(): Promise<void> {
    // Remove temporary frames directory
    try {
      await fs.rm(this.framesDir, { recursive: true, force: true });
    } catch (error) {
      await logToScreenshotCollector(`[VideoRecorder] Warning: Failed to cleanup frames directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async abort(): Promise<void> {
    this.isRecording = false;
    if (this.ws) {
      try {
        await this.sendCdpCommand("Page.stopScreencast");
      } catch {
        // Ignore errors during abort
      }
      this.ws.close();
      this.ws = null;
    }
    await this.cleanup();
  }
}
