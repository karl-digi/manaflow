/**
 * Provider Dispatch Helper
 *
 * Reduces fork diff by centralizing the PVE-LXC vs Morph branching
 * into a single module. Callers use `getInstanceById()` instead of
 * repeating the if/else pattern in every endpoint.
 */

import type { MorphCloudClient } from "morphcloud";
import { getPveLxcClient } from "@/lib/utils/pve-lxc-client";
import {
  wrapMorphInstance,
  wrapPveLxcInstance,
  type SandboxInstance,
} from "@/lib/utils/sandbox-instance";

/**
 * Check if an instance ID belongs to a PVE LXC container.
 */
export function isPveLxcInstanceId(instanceId: string): boolean {
  return (
    instanceId.startsWith("pvelxc-") ||
    instanceId.startsWith("cmux-")
  );
}

/**
 * Get a wrapped SandboxInstance by ID, automatically dispatching
 * to the correct provider based on the instance ID prefix.
 *
 * For PVE-only deployments, morphClient can be null - it will only
 * be used if the instance ID indicates a Morph instance.
 */
export async function getInstanceById(
  instanceId: string,
  morphClient: MorphCloudClient | null,
): Promise<SandboxInstance> {
  if (isPveLxcInstanceId(instanceId)) {
    const pveClient = getPveLxcClient();
    const pveLxcInstance = await pveClient.instances.get({ instanceId });
    return wrapPveLxcInstance(pveLxcInstance);
  }
  if (!morphClient) {
    throw new Error(
      `Cannot get Morph instance ${instanceId}: MORPH_API_KEY not configured`
    );
  }
  const morphInstance = await morphClient.instances.get({ instanceId });
  return wrapMorphInstance(morphInstance);
}

/**
 * Like getInstanceById but returns null on failure instead of throwing.
 */
export async function tryGetInstanceById(
  instanceId: string,
  morphClient: MorphCloudClient | null,
  logTag: string,
): Promise<SandboxInstance | null> {
  try {
    return await getInstanceById(instanceId, morphClient);
  } catch (error) {
    console.error(`[${logTag}] Failed to load instance ${instanceId}`, error);
    return null;
  }
}

/**
 * Get the team ID from a sandbox instance's metadata (works for both providers).
 */
export function getInstanceTeamId(
  instance: SandboxInstance,
): string | undefined {
  return instance.metadata.teamId;
}
