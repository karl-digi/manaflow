"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { PveLxcClient, type PveLxcInstance } from "@cmux/pve-lxc-client";
import {
  PVE_LXC_SNAPSHOT_PRESETS,
  DEFAULT_PVE_LXC_SNAPSHOT_ID,
} from "@cmux/shared/pve-lxc-snapshots";

/**
 * Get PVE LXC client with config from env.
 * PVE_* variables are accessed via process.env directly (not convex-env)
 * to avoid requiring them in all deployments.
 */
function getPveLxcClient(): PveLxcClient {
  const apiUrl = process.env.PVE_API_URL;
  const apiToken = process.env.PVE_API_TOKEN;
  if (!apiUrl || !apiToken) {
    throw new Error("PVE_API_URL and PVE_API_TOKEN not configured");
  }
  return new PveLxcClient({
    apiUrl,
    apiToken,
    node: process.env.PVE_NODE,
    publicDomain: process.env.PVE_PUBLIC_DOMAIN,
    verifyTls: ["true", "1"].includes(process.env.PVE_VERIFY_TLS ?? ""),
    snapshotResolver: resolveSnapshot,
  });
}

/**
 * Resolve a snapshot ID to a template VMID using the shared preset data.
 */
function resolveSnapshot(snapshotId: string): { templateVmid: number } {
  if (/^snapshot_[a-z0-9]+$/i.test(snapshotId)) {
    const preset = PVE_LXC_SNAPSHOT_PRESETS.find((p) =>
      p.versions.some((ver) => ver.snapshotId === snapshotId),
    );
    const versionData = preset?.versions.find((ver) => ver.snapshotId === snapshotId);
    if (!versionData) {
      throw new Error(`PVE LXC snapshot not found: ${snapshotId}`);
    }
    return { templateVmid: versionData.templateVmid };
  }
  throw new Error(
    `Invalid PVE snapshot ID: ${snapshotId}. Expected format: snapshot_*`,
  );
}

/**
 * Extract networking URLs from PVE LXC instance.
 */
function extractNetworkingUrls(instance: PveLxcInstance) {
  const httpServices = instance.networking.httpServices;
  const vscodeService = httpServices.find((s) => s.port === 39378);
  const workerService = httpServices.find((s) => s.port === 39376);  // Node.js worker (Go worker uses 39377)
  const vncService = httpServices.find((s) => s.port === 39380);
  const xtermService = httpServices.find((s) => s.port === 39383);

  return {
    vscodeUrl: vscodeService?.url,
    workerUrl: workerService?.url,
    vncUrl: vncService?.url,
    xtermUrl: xtermService?.url,
  };
}

/**
 * Start a new PVE LXC container instance.
 */
export const startInstance = internalAction({
  args: {
    snapshotId: v.optional(v.string()),
    templateVmid: v.optional(v.number()),
    ttlSeconds: v.optional(v.number()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (_ctx, args) => {
    const client = getPveLxcClient();

    const instance = await client.instances.start({
      snapshotId: args.snapshotId ?? DEFAULT_PVE_LXC_SNAPSHOT_ID,
      templateVmid: args.templateVmid,
      ttlSeconds: args.ttlSeconds ?? 60 * 60,
      metadata: args.metadata,
    });

    const { vscodeUrl, workerUrl, vncUrl, xtermUrl } = extractNetworkingUrls(instance);

    return {
      instanceId: instance.id,
      status: "running",
      vscodeUrl,
      workerUrl,
      vncUrl,
      xtermUrl,
    };
  },
});

/**
 * Get PVE LXC instance status.
 */
export const getInstance = internalAction({
  args: {
    instanceId: v.string(),
  },
  handler: async (_ctx, args) => {
    try {
      const client = getPveLxcClient();
      const instance = await client.instances.get({ instanceId: args.instanceId });
      const { vscodeUrl, workerUrl, vncUrl, xtermUrl } = extractNetworkingUrls(instance);

      return {
        instanceId: args.instanceId,
        status: instance.status === "running" ? "running" : "stopped",
        vscodeUrl,
        workerUrl,
        vncUrl,
        xtermUrl,
      };
    } catch (err) {
      console.warn(`[pve_lxc_actions.getInstance] Failed to get instance ${args.instanceId}:`, err);
      return {
        instanceId: args.instanceId,
        status: "stopped",
        vscodeUrl: null,
        workerUrl: null,
        vncUrl: null,
        xtermUrl: null,
      };
    }
  },
});

/**
 * Execute a command in a PVE LXC container.
 * Returns result even for non-zero exit codes.
 */
export const execCommand = internalAction({
  args: {
    instanceId: v.string(),
    command: v.string(),
  },
  handler: async (_ctx, args) => {
    try {
      const client = getPveLxcClient();
      const instance = await client.instances.get({ instanceId: args.instanceId });
      const result = await instance.exec(args.command);

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exit_code,
      };
    } catch (err) {
      console.error("[pve_lxc_actions.execCommand] Error:", err);
      return {
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exit_code: 1,
      };
    }
  },
});

/**
 * Pause (stop without deleting) a PVE LXC container.
 * The container can be resumed later with resumeInstance.
 */
export const pauseInstance = internalAction({
  args: {
    instanceId: v.string(),
  },
  handler: async (_ctx, args) => {
    const client = getPveLxcClient();
    const instance = await client.instances.get({ instanceId: args.instanceId });
    await instance.pause();

    return { paused: true };
  },
});

/**
 * Extend timeout for a PVE LXC container.
 * PVE LXC doesn't have native TTL - this is a no-op for compatibility.
 */
export const extendTimeout = internalAction({
  args: {
    instanceId: v.string(),
    timeoutMs: v.optional(v.number()),
  },
  handler: async (_ctx, _args) => {
    // PVE LXC containers don't have built-in TTL like E2B sandboxes.
    // TTL is managed at the application level via cron jobs.
    return { extended: true };
  },
});

/**
 * Stop (destroy) a PVE LXC container.
 * Deletes the container to match other providers' stop semantics.
 */
export const stopInstance = internalAction({
  args: {
    instanceId: v.string(),
  },
  handler: async (_ctx, args) => {
    const client = getPveLxcClient();
    const instance = await client.instances.get({ instanceId: args.instanceId });
    await instance.delete();

    return { stopped: true };
  },
});

/**
 * Resume a stopped PVE LXC container.
 */
export const resumeInstance = internalAction({
  args: {
    instanceId: v.string(),
  },
  handler: async (_ctx, args) => {
    const client = getPveLxcClient();
    const instance = await client.instances.get({ instanceId: args.instanceId });
    await instance.resume();

    const { vscodeUrl, workerUrl, vncUrl, xtermUrl } = extractNetworkingUrls(instance);

    return {
      resumed: true,
      instanceId: args.instanceId,
      status: "running",
      vscodeUrl,
      workerUrl,
      vncUrl,
      xtermUrl,
    };
  },
});

/**
 * List all running PVE LXC containers.
 */
export const listInstances = internalAction({
  args: {},
  handler: async () => {
    const client = getPveLxcClient();
    const instances = await client.instances.list();

    return instances.map((inst) => ({
      instanceId: inst.id,
      vmid: inst.vmid,
      status: inst.status,
      hostname: inst.networking.hostname,
    }));
  },
});
