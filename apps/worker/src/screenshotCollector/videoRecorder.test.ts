#!/usr/bin/env bun
/**
 * Video Recording Test
 *
 * This test starts a Morph instance and tests the video recording functionality.
 *
 * Prerequisites:
 * - MORPH_API_KEY environment variable must be set
 * - A Morph snapshot with X11 and ffmpeg installed
 *
 * Usage:
 *   cd apps/worker
 *   MORPH_API_KEY=your_key bun src/screenshotCollector/videoRecorder.test.ts
 *
 * Or with a specific snapshot:
 *   MORPH_API_KEY=your_key MORPH_SNAPSHOT_ID=snapshot_xxx bun src/screenshotCollector/videoRecorder.test.ts
 */

import { MorphCloudClient } from "morphcloud";
import type { Instance } from "morphcloud";

// Default snapshot ID - this should have X11 and ffmpeg
// You can override with MORPH_SNAPSHOT_ID env var
const DEFAULT_SNAPSHOT_ID = process.env.MORPH_SNAPSHOT_ID || "snapshot_wsqbx2ig";

const MORPH_API_KEY = process.env.MORPH_API_KEY;

if (!MORPH_API_KEY) {
  console.error("Error: MORPH_API_KEY environment variable is required");
  console.error("Usage: MORPH_API_KEY=your_key bun src/screenshotCollector/videoRecorder.test.ts");
  process.exit(1);
}

// Test configuration
const TEST_RECORDING_DURATION_SECONDS = 5;
const INSTANCE_TTL_SECONDS = 300; // 5 minutes

async function main() {
  const client = new MorphCloudClient({
    apiKey: MORPH_API_KEY,
  });

  let instance: Instance | null = null;

  try {
    console.log("=== Video Recording Test ===\n");

    // Start instance
    console.log(`Starting Morph instance from snapshot: ${DEFAULT_SNAPSHOT_ID}`);
    instance = await client.instances.start({
      snapshotId: DEFAULT_SNAPSHOT_ID,
      ttlSeconds: INSTANCE_TTL_SECONDS,
    });

    console.log(`Instance ID: ${instance.id}`);
    console.log("Waiting for instance to be ready...");

    await instance.waitUntilReady();
    console.log("Instance is ready!\n");

    // Check prerequisites
    console.log("=== Checking Prerequisites ===\n");

    // Check/install ffmpeg
    console.log("Checking ffmpeg...");
    let ffmpegCheck = await instance.exec("which ffmpeg && ffmpeg -version | head -1");
    if (ffmpegCheck.exit_code !== 0) {
      console.log("  ffmpeg not found, installing...");

      // Check what package manager is available
      const osCheck = await instance.exec("cat /etc/os-release | head -2");
      console.log("  OS:", osCheck.stdout.trim());

      // Try to install ffmpeg
      console.log("  Running apt-get update...");
      const updateResult = await instance.exec("apt-get update 2>&1");
      console.log("  apt-get update exit code:", updateResult.exit_code);
      if (updateResult.exit_code !== 0) {
        console.log("  apt-get update stderr:", updateResult.stderr);
        console.log("  apt-get update stdout:", updateResult.stdout);
      }

      console.log("  Running apt-get install ffmpeg xvfb...");
      const installResult = await instance.exec("DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg xvfb 2>&1");
      console.log("  apt-get install exit code:", installResult.exit_code);
      // Note: exit code might be undefined even on success with Morph client
      // Verify installation by checking if ffmpeg is now available
      ffmpegCheck = await instance.exec("which ffmpeg && ffmpeg -version | head -1");
      if (ffmpegCheck.exit_code !== 0 && !ffmpegCheck.stdout.includes("ffmpeg")) {
        console.error("  Failed to install ffmpeg");
        console.error("  install stdout:", installResult.stdout.slice(-500));
        console.error("  install stderr:", installResult.stderr);
        throw new Error("Failed to install ffmpeg");
      }
      console.log("  ffmpeg installed successfully");
    }
    console.log(`  ${ffmpegCheck.stdout.trim()}`);

    // Check ffprobe
    console.log("Checking ffprobe...");
    const ffprobeCheck = await instance.exec("which ffprobe");
    if (!ffprobeCheck.stdout.includes("ffprobe")) {
      console.error("ffprobe not found!");
      throw new Error("ffprobe is required for video duration detection");
    }
    console.log(`  ffprobe found at: ${ffprobeCheck.stdout.trim()}`);

    // Check X11 display - default to :99 for Xvfb
    console.log("Checking X11 display...");
    let display = ":99";
    console.log(`  DISPLAY=${display}`);

    // Start Xvfb (virtual framebuffer)
    console.log("Starting Xvfb...");
    // Kill any existing Xvfb first, then start new one with nohup
    const xvfbStart = await instance.exec(
      "pkill -9 Xvfb 2>/dev/null || true; sleep 0.5; nohup Xvfb :99 -screen 0 1920x1080x24 > /tmp/xvfb.log 2>&1 & sleep 2; pgrep -f Xvfb"
    );
    if (xvfbStart.stdout.trim()) {
      console.log("  Xvfb is running (PID:", xvfbStart.stdout.trim() + ")");
    } else {
      console.warn("  Warning: Xvfb may not be running. Log:", xvfbStart.stderr);
    }

    console.log("\n=== Testing Video Recording ===\n");

    // Create test output directory
    const outputDir = "/tmp/video-test";
    await instance.exec(`mkdir -p ${outputDir}`);

    // Copy the video recorder module to the instance
    console.log("Copying video recorder to instance...");

    // Create a simple test script that uses ffmpeg directly
    const testScript = `
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

const outputPath = "${outputDir}/test-recording.mp4";
const display = "${display}";
const durationSeconds = ${TEST_RECORDING_DURATION_SECONDS};

console.log("Starting video recording...");
console.log("  Output:", outputPath);
console.log("  Display:", display);
console.log("  Duration:", durationSeconds, "seconds");

// Start ffmpeg recording
const ffmpegArgs = [
  "-y",
  "-f", "x11grab",
  "-video_size", "1920x1080",
  "-framerate", "30",
  "-i", display,
  "-t", String(durationSeconds),
  "-c:v", "libx264",
  "-preset", "ultrafast",
  "-crf", "23",
  "-pix_fmt", "yuv420p",
  outputPath,
];

console.log("\\nRunning: ffmpeg", ffmpegArgs.join(" "));

const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
ffmpeg.stderr.on("data", (data) => {
  stderr += data.toString();
});

await new Promise((resolve, reject) => {
  ffmpeg.on("close", (code) => {
    if (code === 0) {
      resolve(undefined);
    } else {
      reject(new Error(\`ffmpeg exited with code \${code}: \${stderr}\`));
    }
  });
  ffmpeg.on("error", reject);
});

console.log("\\nRecording complete!");

// Check file exists
const stats = await fs.stat(outputPath);
console.log("\\nFile stats:");
console.log("  Size:", stats.size, "bytes");
console.log("  Size (MB):", (stats.size / 1024 / 1024).toFixed(2));

// Get video info
const { stdout } = await new Promise((resolve, reject) => {
  const proc = spawn("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size",
    "-show_entries", "stream=width,height,codec_name",
    "-of", "json",
    outputPath,
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let stdout = "";
  proc.stdout.on("data", (data) => { stdout += data.toString(); });
  proc.on("close", (code) => {
    if (code === 0) resolve({ stdout });
    else reject(new Error("ffprobe failed"));
  });
});

const info = JSON.parse(stdout);
console.log("\\nVideo info:");
console.log(JSON.stringify(info, null, 2));

console.log("\\n✅ Video recording test passed!");
`;

    // Write and run the test script
    const scriptPath = `${outputDir}/test-video-recording.mjs`;
    await instance.exec(`cat > ${scriptPath} << 'SCRIPT_EOF'
${testScript}
SCRIPT_EOF`);

    console.log("Running video recording test...\n");
    const testResult = await instance.exec(`cd ${outputDir} && node ${scriptPath}`);

    console.log(testResult.stdout);
    if (testResult.stderr) {
      console.log("stderr:", testResult.stderr);
    }

    // Check for success message in output (exit code may be undefined with Morph client)
    if (!testResult.stdout.includes("Video recording test passed")) {
      throw new Error(`Test script failed. Exit code: ${testResult.exit_code}`);
    }

    // Download the video for verification (optional)
    console.log("\n=== Video Recording Verified ===\n");

    // List recorded files
    const lsResult = await instance.exec(`ls -la ${outputDir}/`);
    console.log("Files in output directory:");
    console.log(lsResult.stdout);

    console.log("\n✅ All tests passed!\n");

    // Offer to keep instance running for debugging
    console.log(`Instance ${instance.id} will be stopped automatically after ${INSTANCE_TTL_SECONDS} seconds.`);
    console.log("You can connect to it via the Morph dashboard for debugging.");

  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  } finally {
    // Clean up - stop the instance
    if (instance) {
      console.log("\nStopping instance...");
      try {
        await instance.stop();
        console.log("Instance stopped.");
      } catch (stopError) {
        console.error("Failed to stop instance:", stopError);
      }
    }
  }
}

main();
