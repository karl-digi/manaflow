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

/** Error patterns that indicate instance genuinely doesn't exist */
const NOT_FOUND_PATTERNS = [
  "Unable to resolve VMID",
  "not found",
  "does not exist",
  "No such instance",
  "404",
];

function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return NOT_FOUND_PATTERNS.some((pattern) =>
    message.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Like getInstanceById but returns null for "not found" errors.
 * Re-throws configuration errors (e.g., MORPH_API_KEY missing) and other failures
 * so callers can distinguish "instance gone" from "provider misconfigured".
 */
export async function tryGetInstanceById(
  instanceId: string,
  morphClient: MorphCloudClient | null,
  logTag: string,
): Promise<SandboxInstance | null> {
  try {
    return await getInstanceById(instanceId, morphClient);
  } catch (error) {
    // Only return null for genuine "not found" errors
    if (isNotFoundError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[${logTag}] Instance ${instanceId} not found: ${message}`);
      return null;
    }
    // Re-throw configuration errors and other failures
    throw error;
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
