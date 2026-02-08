"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { env } from "../_shared/convex-env";
import {
  DEFAULT_MODAL_TEMPLATE_ID,
  getModalTemplateByPresetId,
} from "@cmux/shared/modal-templates";
import { ModalClient, type ModalInstance } from "@cmux/modal-client";

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
 * Extract networking URLs from Modal instance.
 */
function extractNetworkingUrls(instance: ModalInstance) {
  const httpServices = instance.networking.httpServices;
  const vscodeService = httpServices.find(
    (s) => s.port === 39378 || s.name === "vscode",
  );
  const workerService = httpServices.find(
    (s) => s.port === 39377 || s.name === "worker",
  );
  const vncService = httpServices.find(
    (s) => s.port === 39380 || s.name === "vnc",
  );

  return {
    vscodeUrl: vscodeService?.url,
    workerUrl: workerService?.url,
    vncUrl: vncService?.url,
  };
}

/**
 * Start a new Modal sandbox instance.
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
    const image = args.image ?? preset?.image ?? "ubuntu:22.04";

    try {
      const instance = await client.instances.start({
        gpu,
        cpu: args.cpu,
        memoryMiB: args.memoryMiB,
        timeoutSeconds: args.ttlSeconds ?? 60 * 60,
        metadata: args.metadata,
        envs: args.envs,
        image,
        encryptedPorts: [39377, 39378, 39380],
      });

      const { vscodeUrl, workerUrl, vncUrl } =
        extractNetworkingUrls(instance);

      return {
        instanceId: instance.id,
        status: "running",
        gpu: gpu ?? null,
        vscodeUrl,
        workerUrl,
        vncUrl,
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
      const { vscodeUrl, workerUrl, vncUrl } =
        extractNetworkingUrls(instance);

      return {
        instanceId: args.instanceId,
        status: isRunning ? "running" : "stopped",
        vscodeUrl,
        workerUrl,
        vncUrl,
      };
    } catch {
      return {
        instanceId: args.instanceId,
        status: "stopped",
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
