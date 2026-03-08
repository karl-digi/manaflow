/**
 * PVE LXC Client - Thin wrapper around @cmux/pve-lxc-client
 *
 * Re-exports the client classes and types from the package,
 * and provides a factory function that configures the client
 * from www environment variables.
 */

import { PveLxcClient } from "@cmux/pve-lxc-client";
import { env } from "./www-env";
import { PVE_LXC_SNAPSHOT_PRESETS } from "./pve-lxc-defaults";

export { PveLxcClient, PveLxcInstance } from "@cmux/pve-lxc-client";
export type {
  PveLxcClientConfig,
  ExecResult,
  HttpService,
  ContainerNetworking,
  ContainerMetadata,
  ContainerStatus,
  StartContainerOptions,
} from "@cmux/pve-lxc-client";

/**
 * Resolve a snapshot ID to a template VMID using the shared preset data.
 */
function resolveSnapshot(snapshotId: string): { templateVmid: number } {
  if (/^snapshot_[a-z0-9]+$/i.test(snapshotId)) {
    const preset = PVE_LXC_SNAPSHOT_PRESETS.find((p) =>
      p.versions.some((v) => v.snapshotId === snapshotId),
    );
    const versionData = preset?.versions.find((v) => v.snapshotId === snapshotId);
    if (!versionData) {
      throw new Error(`PVE LXC snapshot not found: ${snapshotId}`);
    }
    return { templateVmid: versionData.templateVmid };
  }
  throw new Error(
    `Invalid PVE snapshot ID: ${snapshotId}. Expected format: snapshot_*`
  );
}

/**
 * Create a PVE LXC client instance configured from environment variables.
 */
export function getPveLxcClient(): PveLxcClient {
  if (!env.PVE_API_URL || !env.PVE_API_TOKEN) {
    throw new Error("PVE API URL and token not configured");
  }

  return new PveLxcClient({
    apiUrl: env.PVE_API_URL,
    apiToken: env.PVE_API_TOKEN,
    node: env.PVE_NODE,
    publicDomain: env.PVE_PUBLIC_DOMAIN,
    verifyTls: Boolean(env.PVE_VERIFY_TLS),
    snapshotResolver: resolveSnapshot,
  });
}
