"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { env } from "../_shared/convex-env";
import {
  DEFAULT_MODAL_TEMPLATE_ID,
  getModalTemplateByPresetId,
} from "@cmux/shared/modal-templates";
import { ModalClient, type ModalInstance } from "@cmux/modal-client";

const CMUX_CODE_VERSION = "0.9.0";

/**
 * Get Modal client with credentials from env
 */
function getModalClient(): ModalClient {
  const tokenId = env.MODAL_TOKEN_ID;
  const tokenSecret = env.MODAL_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    throw new Error("MODAL_TOKEN_ID and MODAL_TOKEN_SECRET not configured");
  }
  return new ModalClient({ tokenId, tokenSecret });
}

/**
 * Generate a 64-char hex auth token (same format as E2B worker daemon).
 */
function generateAuthToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Extract networking URLs from Modal instance.
 */
function extractNetworkingUrls(instance: ModalInstance) {
  const httpServices = instance.networking.httpServices;
  const jupyterService = httpServices.find(
    (s) => s.port === 8888 || s.name === "jupyter",
  );
  const vscodeService = httpServices.find(
    (s) => s.port === 39378 || s.name === "vscode",
  );
  const vncService = httpServices.find(
    (s) => s.port === 39380 || s.name === "vnc",
  );
  const workerService = httpServices.find(
    (s) => s.port === 39377 || s.name === "worker",
  );

  return {
    jupyterUrl: jupyterService?.url,
    vscodeUrl: vscodeService?.url,
    vncUrl: vncService?.url,
    workerUrl: workerService?.url,
  };
}

/**
 * HEAVY install script — runs once to build the snapshot image.
 * Installs all system packages, cmux-code, worker-daemon, Jupyter, XFCE, Chrome.
 * Does NOT start any services (that happens in the startup script).
 */
function buildInstallScript(): string {
  return `#!/bin/bash
set -e

# Create workspace directory
mkdir -p /home/user/workspace

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq > /dev/null 2>&1
apt-get install -y -qq \\
  curl procps jq wget gnupg pip \\
  tigervnc-standalone-server tigervnc-common \\
  xfce4 xfce4-terminal dbus-x11 \\
  novnc python3-websockify \\
  fonts-liberation fonts-dejavu \\
  > /dev/null 2>&1

# Install Google Chrome
curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb
apt-get install -y -qq /tmp/chrome.deb > /dev/null 2>&1 || apt-get install -y -qq -f > /dev/null 2>&1
rm -f /tmp/chrome.deb

# Install cmux-code (VSCode fork)
mkdir -p /app/cmux-code
curl -fSL --retry 3 --retry-delay 2 -o /tmp/cmux-code.tar.gz \\
  "https://github.com/manaflow-ai/vscode-1/releases/download/v${CMUX_CODE_VERSION}/vscode-server-linux-x64-web.tar.gz"
tar xf /tmp/cmux-code.tar.gz -C /app/cmux-code/ --strip-components=1
rm -f /tmp/cmux-code.tar.gz

# Install worker daemon (Go binary for PTY/SSH)
curl -fSL --retry 3 --retry-delay 2 -o /usr/local/bin/worker-daemon \\
  "https://github.com/manaflow-ai/vscode-1/releases/download/v${CMUX_CODE_VERSION}/worker-daemon"
chmod +x /usr/local/bin/worker-daemon

# Install JupyterLab
pip install -q jupyterlab 2>/dev/null || true

# Clean apt cache to reduce snapshot size
apt-get clean > /dev/null 2>&1
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

echo "INSTALL_COMPLETE"
`;
}

/**
 * LIGHTWEIGHT startup script — runs on each new instance from a snapshot.
 * Only writes auth token and starts services. No package installation needed.
 */
function buildStartupScript(authToken: string): string {
  return `#!/bin/bash
set -e

mkdir -p /home/user/workspace

# Write auth token and boot ID so worker-daemon uses our token
echo -n '${authToken}' > /home/user/.worker-auth-token
echo -n '${authToken}' > /home/user/.vscode-token
cat /proc/sys/kernel/random/boot_id | tr -d '\\n' > /home/user/.token-boot-id
chmod 600 /home/user/.worker-auth-token /home/user/.vscode-token /home/user/.token-boot-id

# --- Start TigerVNC ---
nohup Xtigervnc :1 \\
  -geometry 1920x1080 \\
  -depth 24 \\
  -localhost \\
  -SecurityTypes None \\
  -rfbport 5901 \\
  -AlwaysShared \\
  -AcceptSetDesktopSize=1 \\
  > /tmp/tigervnc.log 2>&1 &
sleep 1

# XFCE desktop
export DISPLAY=:1
export HOME=/root
export XDG_RUNTIME_DIR=/tmp/runtime-root
mkdir -p /tmp/runtime-root
eval \$(dbus-launch --sh-syntax) 2>/dev/null || true
nohup startxfce4 > /tmp/xfce.log 2>&1 &
sleep 2

# Chrome
mkdir -p /root/.config/chrome
nohup google-chrome \\
  --no-sandbox --disable-dev-shm-usage --disable-gpu --disable-software-rasterizer \\
  --no-first-run --no-default-browser-check --disable-session-crashed-bubble \\
  --disable-default-apps --disable-sync --disable-translate --disable-infobars \\
  --disable-features=ChromeWhatsNewUI,AutofillServerCommunication \\
  --start-maximized --window-position=0,0 --window-size=1920,1080 \\
  --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 \\
  --user-data-dir=/root/.config/chrome --password-store=basic \\
  about:blank > /tmp/chrome.log 2>&1 &

# noVNC + websockify on port 39380
nohup websockify --web /usr/share/novnc --heartbeat 1 0.0.0.0:39380 localhost:5901 > /tmp/novnc.log 2>&1 &

# cmux-code on port 39378
nohup /app/cmux-code/bin/code-server-oss \\
  --host 0.0.0.0 --port 39378 \\
  --connection-token-file /home/user/.worker-auth-token \\
  --disable-workspace-trust --disable-telemetry --telemetry-level off \\
  /home/user/workspace > /tmp/cmux-code.log 2>&1 &

# Worker daemon on port 39377
nohup /usr/local/bin/worker-daemon > /tmp/worker-daemon.log 2>&1 &

# Jupyter Lab on port 8888
nohup jupyter lab \\
  --ip=0.0.0.0 --port=8888 \\
  --ServerApp.token='${authToken}' \\
  --ServerApp.allow_root=True \\
  --ServerApp.root_dir=/home/user/workspace \\
  --no-browser > /tmp/jupyter.log 2>&1 &

sleep 2
echo "STARTUP_COMPLETE"
`;
}

/**
 * Build a snapshot image with all software pre-installed.
 * Run this once, then use the returned imageId for fast starts.
 */
export const buildSnapshot = internalAction({
  args: {
    image: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const client = getModalClient();
    try {
      const baseImage = args.image ?? "python:3.11-slim";
      console.log(`[modal_actions.buildSnapshot] Creating sandbox from ${baseImage}...`);

      const instance = await client.instances.start({
        image: baseImage,
        timeoutSeconds: 30 * 60,
        encryptedPorts: [8888, 39377, 39378, 39380],
      });

      console.log("[modal_actions.buildSnapshot] Running install script...");
      const result = await instance.exec(buildInstallScript());
      if (result.exit_code !== 0) {
        console.error("[modal_actions.buildSnapshot] Install failed:", result.stderr);
        throw new Error(`Install script failed: ${result.stderr}`);
      }
      console.log("[modal_actions.buildSnapshot] Install complete, snapshotting...");

      const snapshotImageId = await instance.snapshotFilesystem(5 * 60 * 1000);
      console.log(`[modal_actions.buildSnapshot] Snapshot created: ${snapshotImageId}`);

      await instance.stop();

      return { snapshotImageId };
    } finally {
      client.close();
    }
  },
});

/**
 * Start a new Modal sandbox instance.
 * Uses MODAL_SNAPSHOT_IMAGE_ID env var for fast startup if available,
 * otherwise falls back to installing everything from scratch.
 */
export const startInstance = internalAction({
  args: {
    templateId: v.optional(v.string()),
    gpu: v.optional(v.string()),
    cpu: v.optional(v.number()),
    memoryMiB: v.optional(v.number()),
    ttlSeconds: v.optional(v.number()),
    metadata: v.optional(v.record(v.string(), v.string())),
    envs: v.optional(v.record(v.string(), v.string())),
    image: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const client = getModalClient();

    // Resolve template preset to get GPU/image config
    const presetId = args.templateId ?? DEFAULT_MODAL_TEMPLATE_ID;
    const preset = getModalTemplateByPresetId(presetId);
    const gpu = args.gpu ?? preset?.gpu;
    const baseImage = args.image ?? preset?.image ?? "python:3.11-slim";

    // Check for pre-built snapshot
    const snapshotImageId = env.MODAL_SNAPSHOT_IMAGE_ID;
    const useSnapshot = !!snapshotImageId;

    try {
      console.log(
        useSnapshot
          ? `[modal_actions] Starting from snapshot ${snapshotImageId}`
          : `[modal_actions] Starting from base image ${baseImage} (no snapshot)`,
      );

      const instance = await client.instances.start({
        gpu,
        cpu: args.cpu,
        memoryMiB: args.memoryMiB,
        timeoutSeconds: args.ttlSeconds ?? 60 * 60,
        metadata: args.metadata,
        envs: args.envs,
        ...(useSnapshot
          ? { snapshotImageId }
          : { image: baseImage }),
        encryptedPorts: [8888, 39377, 39378, 39380],
      });

      const authToken = generateAuthToken();

      if (useSnapshot) {
        // Snapshot has everything installed — just start services
        console.log("[modal_actions] Running lightweight startup script...");
        const result = await instance.exec(buildStartupScript(authToken));
        if (result.exit_code !== 0) {
          console.error("[modal_actions] Startup script failed:", result.stderr);
        }
      } else {
        // No snapshot — run the full install + startup (slow path)
        console.log("[modal_actions] No snapshot, running full setup...");
        const installResult = await instance.exec(buildInstallScript());
        if (installResult.exit_code !== 0) {
          console.error("[modal_actions] Install failed:", installResult.stderr);
        }
        const startResult = await instance.exec(buildStartupScript(authToken));
        if (startResult.exit_code !== 0) {
          console.error("[modal_actions] Startup failed:", startResult.stderr);
        }
      }

      // Refresh tunnel URLs
      await instance.refreshTunnels();
      const { jupyterUrl, vscodeUrl, vncUrl, workerUrl } =
        extractNetworkingUrls(instance);

      return {
        instanceId: instance.id,
        status: "running",
        gpu: gpu ?? null,
        authToken,
        jupyterUrl: jupyterUrl
          ? `${jupyterUrl}?token=${authToken}`
          : undefined,
        vscodeUrl: vscodeUrl
          ? `${vscodeUrl}?tkn=${authToken}&folder=/home/user/workspace`
          : undefined,
        workerUrl: workerUrl ?? undefined,
        vncUrl: vncUrl
          ? `${vncUrl}/vnc.html?autoconnect=true&resize=scale&quality=9&compression=0&show_dot=true&reconnect=true&reconnect_delay=1000`
          : undefined,
      };
    } finally {
      client.close();
    }
  },
});

/**
 * Get Modal instance status.
 */
export const getInstance = internalAction({
  args: {
    instanceId: v.string(),
  },
  handler: async (_ctx, args) => {
    const client = getModalClient();
    try {
      const instance = await client.instances.get({
        instanceId: args.instanceId,
      });
      const isRunning = await instance.isRunning();

      // Refresh tunnels for current URLs
      await instance.refreshTunnels();
      const { jupyterUrl, vscodeUrl, vncUrl, workerUrl } =
        extractNetworkingUrls(instance);

      return {
        instanceId: args.instanceId,
        status: isRunning ? "running" : "stopped",
        jupyterUrl,
        vscodeUrl,
        workerUrl: workerUrl ?? null,
        vncUrl: vncUrl
          ? `${vncUrl}/vnc.html?autoconnect=true&resize=scale`
          : null,
      };
    } catch {
      return {
        instanceId: args.instanceId,
        status: "stopped",
        jupyterUrl: null,
        vscodeUrl: null,
        workerUrl: null,
        vncUrl: null,
      };
    } finally {
      client.close();
    }
  },
});

/**
 * Execute a command in a Modal sandbox.
 * Returns result even for non-zero exit codes.
 */
export const execCommand = internalAction({
  args: {
    instanceId: v.string(),
    command: v.string(),
  },
  handler: async (_ctx, args) => {
    const client = getModalClient();
    try {
      const instance = await client.instances.get({
        instanceId: args.instanceId,
      });
      const result = await instance.exec(args.command);

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exit_code,
      };
    } catch (err) {
      console.error("[modal_actions.execCommand] Error:", err);
      return {
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exit_code: 1,
      };
    } finally {
      client.close();
    }
  },
});

/**
 * Stop (terminate) a Modal sandbox.
 */
export const stopInstance = internalAction({
  args: {
    instanceId: v.string(),
  },
  handler: async (_ctx, args) => {
    const client = getModalClient();
    try {
      await client.instances.kill(args.instanceId);
      return { stopped: true };
    } finally {
      client.close();
    }
  },
});

/**
 * List all running Modal sandboxes.
 */
export const listInstances = internalAction({
  args: {},
  handler: async () => {
    const client = getModalClient();
    try {
      const sandboxes = await client.instances.list();
      return sandboxes.map((s) => ({
        sandboxId: s.sandboxId,
        startedAt: s.startedAt.toISOString(),
      }));
    } finally {
      client.close();
    }
  },
});
