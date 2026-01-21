#!/usr/bin/env bun
/**
 * Test script to run screenshot collector workflow in a Morph sandbox.
 *
 * This downloads the latest screenshot collector from Convex and runs
 * it in a Morph instance to verify the workflow works end-to-end.
 *
 * Usage:
 *   bun run scripts/test-screenshot-morph.ts
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY - Required for Claude Code
 *   MORPH_API_KEY - Required for Morph (or loaded from .env)
 */

import { MorphCloudClient } from "morphcloud";
import "dotenv/config";

// Use staging for testing
const CONVEX_SITE_URL = "https://famous-camel-162.convex.site";
const LATEST_SNAPSHOT = "snapshot_6ef6oire"; // Version 59, 4vcpu_16gb_48gb

async function main() {
  console.log("=== Test Screenshot Collector in Morph Sandbox ===\n");

  // Check for required env vars
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY environment variable is not set");
    process.exit(1);
  }
  if (!process.env.MORPH_API_KEY) {
    console.error("ERROR: MORPH_API_KEY environment variable is not set");
    process.exit(1);
  }

  const client = new MorphCloudClient();

  console.log(`Starting Morph instance from snapshot ${LATEST_SNAPSHOT}...`);
  const instance = await client.instances.start({
    snapshotId: LATEST_SNAPSHOT,
    ttlSeconds: 60 * 30, // 30 minutes
    ttlAction: "stop",
    metadata: {
      app: "cmux-screenshot-test",
    },
  });

  // Enable wake-on for HTTP and SSH
  void (async () => {
    await instance.setWakeOn(true, true);
  })();

  console.log(`Instance ID: ${instance.id}`);
  console.log("Waiting for instance to be ready...");
  await instance.waitUntilReady();
  console.log("Instance is ready!\n");

  // Expose required ports
  const portsToExpose = [39377, 39378, 39380, 39381, 39382];
  console.log("Exposing ports...");
  await Promise.all(
    portsToExpose.map((port) => instance.exposeHttpService(`port-${port}`, port))
  );

  const exposedServices = instance.networking.httpServices;
  const vscodeService = exposedServices.find((s) => s.port === 39378);
  const workerService = exposedServices.find((s) => s.port === 39377);
  const vncService = exposedServices.find((s) => s.port === 39380);

  console.log("\n=== Instance URLs ===");
  console.log(`VSCode: ${vscodeService?.url}/?folder=/root/workspace`);
  console.log(`Worker: ${workerService?.url}`);
  console.log(`VNC: ${vncService?.url}/vnc.html`);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nStopping instance...");
    try {
      await instance.stop();
    } catch (error) {
      console.error("Error stopping instance:", error);
    }
    process.exit(0);
  });

  // Create a test workspace with some dummy files
  console.log("\n=== Setting up test workspace ===");

  // Create a simple test repo with a UI file
  const setupResult = await instance.exec(`
    set -e
    cd /root/workspace

    # Initialize git repo if not exists
    if [ ! -d .git ]; then
      git init
      git config user.email "test@test.com"
      git config user.name "Test User"
    fi

    # Create a simple React component file
    mkdir -p src
    cat > src/App.tsx << 'EOF'
import React from 'react';

export function App() {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-blue-600">Hello World</h1>
        <p className="mt-4 text-gray-600">This is a test component</p>
        <button className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
          Click me
        </button>
      </div>
    </div>
  );
}
EOF

    # Create a package.json
    cat > package.json << 'EOF'
{
  "name": "test-app",
  "version": "1.0.0",
  "scripts": {
    "dev": "echo 'Dev server would start here'"
  }
}
EOF

    # Add and commit
    git add -A
    git commit -m "Initial commit" || true

    # Add a fake remote origin to simulate a real repo
    git remote add origin https://github.com/fake/repo.git || true
    # Set the HEAD ref for the remote (this is what the collector checks)
    git symbolic-ref refs/remotes/origin/HEAD refs/heads/master

    # Create a branch with UI changes
    git checkout -b feature/ui-update || git checkout feature/ui-update

    # Modify the component
    cat > src/App.tsx << 'EOF'
import React from 'react';

export function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-xl shadow-xl border border-purple-200">
        <h1 className="text-3xl font-extrabold text-purple-600">Welcome!</h1>
        <p className="mt-4 text-gray-700">This component has been updated with new styling</p>
        <div className="mt-6 space-x-4">
          <button className="px-6 py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors">
            Primary Action
          </button>
          <button className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">
            Secondary
          </button>
        </div>
      </div>
    </div>
  );
}
EOF

    git add -A
    git commit -m "Update UI with new purple theme" || true

    echo "Test workspace setup complete"
  `);

  console.log("Setup stdout:", setupResult.stdout);
  if (setupResult.stderr) {
    console.log("Setup stderr:", setupResult.stderr);
  }

  // Download and test the screenshot collector
  console.log("\n=== Testing Screenshot Collector Download ===");

  const endpoint = `${CONVEX_SITE_URL}/api/host-screenshot-collector/latest?staging=false`;
  console.log(`Fetching from: ${endpoint}`);

  const response = await fetch(endpoint);
  if (!response.ok) {
    console.error(`Failed to fetch screenshot collector: ${response.status}`);
    console.error(await response.text());
    await instance.stop();
    process.exit(1);
  }

  const releaseInfo = await response.json();
  console.log("Release info:", JSON.stringify(releaseInfo, null, 2));

  // Download the actual JS file
  console.log(`\nDownloading JS from: ${releaseInfo.url}`);
  const jsResponse = await fetch(releaseInfo.url);
  if (!jsResponse.ok) {
    console.error(`Failed to download JS: ${jsResponse.status}`);
    await instance.stop();
    process.exit(1);
  }
  const jsContent = await jsResponse.text();
  console.log(`Downloaded ${jsContent.length} bytes of JavaScript`);

  // Set environment variables for the worker by restarting it
  // This is needed because the old snapshot code doesn't pass params through the socket properly
  console.log("\n=== Setting environment variables and restarting worker ===");
  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  const restartResult = await instance.exec(`
    # Add environment variables to worker systemd environment
    mkdir -p /etc/systemd/system/cmux-worker.service.d
    cat > /etc/systemd/system/cmux-worker.service.d/override.conf << EOF
[Service]
Environment="CONVEX_SITE_URL=${CONVEX_SITE_URL}"
Environment="ANTHROPIC_API_KEY=${apiKey}"
EOF
    systemctl daemon-reload
    systemctl restart cmux-worker
    echo "Worker restarted with CONVEX_SITE_URL=${CONVEX_SITE_URL}"
    echo "Worker restarted with ANTHROPIC_API_KEY set"
    sleep 3
  `);
  console.log(restartResult.stdout);
  if (restartResult.stderr) {
    console.log("Restart stderr:", restartResult.stderr);
  }

  // Download the collector directly inside the Morph instance (for verification)
  console.log("\n=== Verifying Screenshot Collector Download Inside Instance ===");

  const downloadUrl = releaseInfo.url as string;
  const downloadResult = await instance.exec(`
    curl -fsSL '${downloadUrl}' -o /tmp/screenshot-collector.mjs
    echo "Downloaded collector: $(wc -c < /tmp/screenshot-collector.mjs) bytes"
    head -3 /tmp/screenshot-collector.mjs
  `);
  console.log(downloadResult.stdout);
  if (downloadResult.stderr) {
    console.log("Download stderr:", downloadResult.stderr);
  }

  // Use the worker HTTP endpoint to trigger screenshot collection
  console.log("\n=== Triggering Screenshot Collection via Worker ===");

  // Wait for worker to be ready
  console.log("Waiting for worker health endpoint...");
  let workerReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const healthRes = await fetch(`${workerService?.url}/health`);
      if (healthRes.ok) {
        workerReady = true;
        console.log("Worker is ready!");
        break;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
    console.log(`  Still waiting... (${i + 1}/30)`);
  }

  if (!workerReady) {
    console.error("Worker never became ready");
    await instance.stop();
    process.exit(1);
  }

  // Trigger screenshot collection via Socket.IO polling handshake
  const pollingBase = `${workerService?.url}/socket.io/?EIO=4&transport=polling`;

  console.log("Performing Socket.IO handshake...");
  const handshakeRes = await fetch(`${pollingBase}&t=${Date.now()}`);
  if (!handshakeRes.ok) {
    console.error("Handshake failed:", await handshakeRes.text());
    await instance.stop();
    process.exit(1);
  }
  const handshakeRaw = await handshakeRes.text();
  console.log("Handshake response:", handshakeRaw.substring(0, 200));

  // Parse SID from response (format: 0{"sid":"...", ...}
  const sidMatch = handshakeRaw.match(/"sid":"([^"]+)"/);
  if (!sidMatch) {
    console.error("Failed to parse SID from handshake");
    await instance.stop();
    process.exit(1);
  }
  const sid = sidMatch[1];
  console.log(`Session ID: ${sid}`);

  // Connect to /management namespace
  console.log("Connecting to /management namespace...");
  await fetch(`${pollingBase}&sid=${sid}&t=${Date.now()}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: "40/management",
  });

  // Trigger screenshot collection
  const payload = JSON.stringify([
    "worker:start-screenshot-collection",
    {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      convexUrl: CONVEX_SITE_URL,
    },
  ]);

  console.log("Triggering worker:start-screenshot-collection...");
  const triggerRes = await fetch(`${pollingBase}&sid=${sid}&t=${Date.now()}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: `42/management,${payload}`,
  });
  console.log(`Trigger response status: ${triggerRes.status}`);

  console.log("\nScreenshot collection triggered!");
  console.log("Monitoring for completion...");
  console.log(`\nVSCode: ${vscodeService?.url}/?folder=/var/log/cmux`);
  console.log(`VNC: ${vncService?.url}/vnc.html`);

  // Poll for screenshots to appear
  let screenshotsFound = false;
  const startTime = Date.now();
  const maxWaitMs = 10 * 60 * 1000; // 10 minutes

  while (!screenshotsFound && Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 15000)); // Check every 15 seconds

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  Checking for screenshots... (${elapsed}s elapsed)`);

    // Check screenshot directory
    const lsResult = await instance.exec("ls -la /root/screenshots/ 2>/dev/null | head -10 || echo 'No screenshots yet'");
    console.log(`    ${lsResult.stdout.split("\n")[0]}`);

    // Also check for collector logs
    const logResult = await instance.exec("tail -5 /var/log/cmux/screenshot-collector.log 2>/dev/null || echo 'No log yet'");
    const lastLogLine = logResult.stdout.split("\n").slice(-2)[0];
    if (lastLogLine && lastLogLine !== "No log yet") {
      console.log(`    Log: ${lastLogLine.substring(0, 100)}`);
    }

    // Check if screenshots exist
    if (lsResult.stdout.includes("test-run") || lsResult.stdout.includes(".png") || lsResult.stdout.includes(".mp4")) {
      screenshotsFound = true;
    }

    // Check for completion in logs
    if (logResult.stdout.includes("completed") || logResult.stdout.includes("Structured output captured")) {
      screenshotsFound = true;
    }
  }

  const runResult = { stdout: screenshotsFound ? "Screenshots found!" : "No screenshots found after timeout" };

  console.log("\n=== Test Output ===");
  console.log(runResult.stdout);
  if (runResult.stderr) {
    console.error("Stderr:", runResult.stderr);
  }

  // Check for screenshots
  console.log("\n=== Checking Screenshots Directory ===");
  const lsResult = await instance.exec("ls -la /root/screenshots/ 2>/dev/null || echo 'No screenshots directory'");
  console.log(lsResult.stdout);

  const lsTestRun = await instance.exec("ls -la /root/screenshots/test-run/ 2>/dev/null || echo 'No test-run directory'");
  console.log(lsTestRun.stdout);

  // Check collector logs
  console.log("\n=== Screenshot Collector Logs ===");
  const logsResult = await instance.exec("cat /var/log/cmux/screenshot-collector.log 2>/dev/null | tail -100 || echo 'No logs found'");
  console.log(logsResult.stdout);

  console.log("\n=== Test Complete ===");
  console.log(`Instance is still running. VSCode: ${vscodeService?.url}/?folder=/root/workspace`);
  console.log("Press Ctrl+C to stop the instance...");

  // Keep running
  await new Promise(() => {});
}

main().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
