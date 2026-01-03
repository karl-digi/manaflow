"use node";

/**
 * Unified Sandbox Instance Maintenance
 *
 * Provider-agnostic maintenance handlers for sandbox instances.
 * Handles pause/stop lifecycle for all providers: morph, pve-lxc, docker, daytona.
 *
 * Design principles:
 * 1. Provider detection via instance ID prefix
 * 2. Pluggable provider-specific clients
 * 3. Shared activity tracking via sandboxInstances.ts
 * 4. Graceful handling when provider APIs are unavailable
 */

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { env } from "../_shared/convex-env";
import {
  createMorphCloudClient,
  listInstancesInstanceGet,
  pauseInstanceInstanceInstanceIdPausePost,
  stopInstanceInstanceInstanceIdDelete,
} from "@cmux/morphcloud-openapi-client";
import type { SandboxProvider } from "./sandboxInstances";

// ============================================================================
// Configuration
// ============================================================================

const PAUSE_HOURS_THRESHOLD = 20;
const STOP_DAYS_THRESHOLD = 14; // 2 weeks
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const BATCH_SIZE = 5;

// ============================================================================
// Provider Client Interfaces
// ============================================================================

interface ProviderInstance {
  id: string;
  status: string;
  created: number; // Unix timestamp in seconds
  metadata?: {
    app?: string;
    teamId?: string;
    userId?: string;
  };
}

interface ProviderClient {
  listInstances(): Promise<ProviderInstance[]>;
  pauseInstance(instanceId: string): Promise<void>;
  stopInstance(instanceId: string): Promise<void>;
}

// ============================================================================
// Morph Provider Client
// ============================================================================

function createMorphProviderClient(apiKey: string): ProviderClient {
  const client = createMorphCloudClient({ auth: apiKey });

  return {
    async listInstances(): Promise<ProviderInstance[]> {
      const response = await listInstancesInstanceGet({ client });
      if (response.error) {
        throw new Error(`Morph API error: ${JSON.stringify(response.error)}`);
      }
      return (response.data?.data ?? [])
        .filter((inst) => inst.status !== undefined)
        .map((inst) => ({
          id: inst.id,
          status: inst.status as string,
          created: inst.created,
          metadata: inst.metadata as ProviderInstance["metadata"],
        }));
    },

    async pauseInstance(instanceId: string): Promise<void> {
      const response = await pauseInstanceInstanceInstanceIdPausePost({
        client,
        path: { instance_id: instanceId },
      });
      if (response.error) {
        throw new Error(`Morph pause error: ${JSON.stringify(response.error)}`);
      }
    },

    async stopInstance(instanceId: string): Promise<void> {
      const response = await stopInstanceInstanceInstanceIdDelete({
        client,
        path: { instance_id: instanceId },
      });
      if (response.error) {
        throw new Error(`Morph stop error: ${JSON.stringify(response.error)}`);
      }
    },
  };
}

// ============================================================================
// PVE LXC Provider Client
// ============================================================================

interface PveContainerStatus {
  vmid: number;
  status: string;
  name?: string;
  template?: number; // 1 if container is a template
}

interface PveApiResponse<T> {
  data: T;
}

async function pveApiRequest<T>(
  apiUrl: string,
  apiToken: string,
  method: string,
  path: string
): Promise<T> {
  const url = `${apiUrl}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `PVEAPIToken=${apiToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PVE API error ${response.status}: ${text}`);
  }

  const json = (await response.json()) as PveApiResponse<T>;
  return json.data;
}

async function pveWaitForTask(
  apiUrl: string,
  apiToken: string,
  node: string,
  upid: string,
  timeoutMs: number = 60000
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 2000;

  while (Date.now() - startTime < timeoutMs) {
    const status = await pveApiRequest<{ status: string; exitstatus?: string }>(
      apiUrl,
      apiToken,
      "GET",
      `/api2/json/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`
    );

    if (status.status === "stopped") {
      if (status.exitstatus !== "OK") {
        throw new Error(`PVE task failed: ${status.exitstatus}`);
      }
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error("PVE task timeout");
}

function createPveLxcProviderClient(
  apiUrl: string,
  apiToken: string,
  node?: string
): ProviderClient {
  let resolvedNode: string | null = node || null;

  async function getNode(): Promise<string> {
    if (resolvedNode) return resolvedNode;

    const nodes = await pveApiRequest<Array<{ node: string }>>(
      apiUrl,
      apiToken,
      "GET",
      "/api2/json/nodes"
    );

    if (!nodes || nodes.length === 0) {
      throw new Error("No PVE nodes found");
    }

    resolvedNode = nodes[0].node;
    return resolvedNode;
  }

  return {
    async listInstances(): Promise<ProviderInstance[]> {
      const nodeName = await getNode();
      const containers = await pveApiRequest<PveContainerStatus[]>(
        apiUrl,
        apiToken,
        "GET",
        `/api2/json/nodes/${nodeName}/lxc`
      );

      // Filter to cmux containers (hostname starts with "cmux-")
      // Exclude templates and high VMID ranges (>=9000) used for templates
      // Note: PVE doesn't have native metadata, so we rely on hostname convention
      return containers
        .filter((c) => c.name?.startsWith("cmux-"))
        .filter((c) => c.template !== 1) // Exclude PVE templates
        .filter((c) => c.vmid < 9000) // Exclude template VMID range (9000-9999)
        .map((c) => ({
          id: `pve_lxc_${c.vmid}`,
          status: c.status === "running" ? "ready" : c.status,
          // PVE doesn't track creation time easily, use 0 as fallback
          // The activity table will have the actual creation time
          created: 0,
          metadata: {
            app: "cmux", // Assume cmux for now
          },
        }));
    },

    async pauseInstance(instanceId: string): Promise<void> {
      // Extract VMID from instance ID (pve_lxc_XXX)
      const match = instanceId.match(/^pve_lxc_(\d+)$/);
      if (!match) {
        throw new Error(`Invalid PVE LXC instance ID: ${instanceId}`);
      }
      const vmid = match[1];
      const nodeName = await getNode();

      // PVE LXC doesn't support hibernate, so we stop the container
      const upid = await pveApiRequest<string>(
        apiUrl,
        apiToken,
        "POST",
        `/api2/json/nodes/${nodeName}/lxc/${vmid}/status/stop`
      );

      await pveWaitForTask(apiUrl, apiToken, nodeName, upid);
    },

    async stopInstance(instanceId: string): Promise<void> {
      // Extract VMID from instance ID (pve_lxc_XXX)
      const match = instanceId.match(/^pve_lxc_(\d+)$/);
      if (!match) {
        throw new Error(`Invalid PVE LXC instance ID: ${instanceId}`);
      }
      const vmid = match[1];
      const nodeName = await getNode();

      // First stop, then delete
      try {
        const stopUpid = await pveApiRequest<string>(
          apiUrl,
          apiToken,
          "POST",
          `/api2/json/nodes/${nodeName}/lxc/${vmid}/status/stop`
        );
        await pveWaitForTask(apiUrl, apiToken, nodeName, stopUpid);
      } catch {
        // May already be stopped
      }

      const deleteUpid = await pveApiRequest<string>(
        apiUrl,
        apiToken,
        "DELETE",
        `/api2/json/nodes/${nodeName}/lxc/${vmid}`
      );

      await pveWaitForTask(apiUrl, apiToken, nodeName, deleteUpid);
    },
  };
}

// ============================================================================
// Provider Factory
// ============================================================================

interface ProviderConfig {
  provider: SandboxProvider;
  client: ProviderClient | null;
  available: boolean;
  error?: string;
}

function getProviderConfigs(): ProviderConfig[] {
  const configs: ProviderConfig[] = [];

  // Morph provider
  if (env.MORPH_API_KEY) {
    try {
      configs.push({
        provider: "morph",
        client: createMorphProviderClient(env.MORPH_API_KEY),
        available: true,
      });
    } catch (error) {
      configs.push({
        provider: "morph",
        client: null,
        available: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  } else {
    configs.push({
      provider: "morph",
      client: null,
      available: false,
      error: "MORPH_API_KEY not configured",
    });
  }

  // PVE LXC provider
  // Note: Use process.env directly to avoid Convex static analysis requiring these vars
  const pveApiUrl = process.env.PVE_API_URL;
  const pveApiToken = process.env.PVE_API_TOKEN;
  const pveNode = process.env.PVE_NODE;

  if (pveApiUrl && pveApiToken) {
    try {
      configs.push({
        provider: "pve-lxc",
        client: createPveLxcProviderClient(pveApiUrl, pveApiToken, pveNode),
        available: true,
      });
    } catch (error) {
      configs.push({
        provider: "pve-lxc",
        client: null,
        available: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  } else {
    configs.push({
      provider: "pve-lxc",
      client: null,
      available: false,
      error: "PVE_API_URL or PVE_API_TOKEN not configured",
    });
  }

  // Docker provider - placeholder for future implementation
  configs.push({
    provider: "docker",
    client: null,
    available: false,
    error: "Docker provider not yet implemented",
  });

  // Daytona provider - placeholder for future implementation
  configs.push({
    provider: "daytona",
    client: null,
    available: false,
    error: "Daytona provider not yet implemented",
  });

  return configs;
}

// ============================================================================
// Maintenance Actions
// ============================================================================

/**
 * Test function to debug provider configuration (public for debugging).
 * Returns provider availability without actually pausing anything.
 * NOTE: Remove this function before production deployment!
 */
import { action } from "./_generated/server";

export const debugProviderConfig = action({
  args: {},
  handler: async () => {
    const configs = getProviderConfigs();
    const results = configs.map((c) => ({
      provider: c.provider,
      available: c.available,
      error: c.error,
    }));

    console.log("[sandboxMaintenance:debug] Provider configs:", JSON.stringify(results, null, 2));
    console.log("[sandboxMaintenance:debug] CONVEX_IS_PRODUCTION:", env.CONVEX_IS_PRODUCTION);
    console.log("[sandboxMaintenance:debug] MORPH_API_KEY set:", !!env.MORPH_API_KEY);
    console.log("[sandboxMaintenance:debug] PVE_API_URL set:", !!process.env.PVE_API_URL);
    console.log("[sandboxMaintenance:debug] PVE_API_TOKEN set:", !!process.env.PVE_API_TOKEN);

    return {
      providers: results,
      isProduction: env.CONVEX_IS_PRODUCTION,
      morphApiKeySet: !!env.MORPH_API_KEY,
      pveApiUrlSet: !!process.env.PVE_API_URL,
      pveApiTokenSet: !!process.env.PVE_API_TOKEN,
    };
  },
});

/**
 * Test function to list instances from all providers (public for debugging).
 * NOTE: Remove this function before production deployment!
 */
export const debugListInstances = action({
  args: {},
  handler: async () => {
    const configs = getProviderConfigs();
    const results: Record<string, { count: number; instances: Array<{ id: string; status: string }>; error?: string }> = {};

    for (const config of configs) {
      if (!config.available || !config.client) {
        results[config.provider] = {
          count: 0,
          instances: [],
          error: config.error,
        };
        continue;
      }

      try {
        const instances = await config.client.listInstances();
        const cmuxInstances = instances.filter((inst) => inst.metadata?.app?.startsWith("cmux"));
        results[config.provider] = {
          count: cmuxInstances.length,
          instances: cmuxInstances.slice(0, 10).map((i) => ({ id: i.id, status: i.status })),
        };
        console.log(`[sandboxMaintenance:debug] ${config.provider}: ${cmuxInstances.length} cmux instances`);
      } catch (error) {
        results[config.provider] = {
          count: 0,
          instances: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
        console.error(`[sandboxMaintenance:debug] ${config.provider} error:`, error);
      }
    }

    return results;
  },
});

/**
 * Pauses all sandbox instances that have been running for more than the threshold.
 * Called by the daily cron job.
 */
export const pauseOldSandboxInstances = internalAction({
  args: {},
  handler: async (ctx) => {
    // Only run in production
    if (!env.CONVEX_IS_PRODUCTION) {
      console.log("[sandboxMaintenance:pause] Skipping: not in production");
      return;
    }

    const providerConfigs = getProviderConfigs();
    const now = Date.now();
    const thresholdMs = PAUSE_HOURS_THRESHOLD * MILLISECONDS_PER_HOUR;

    let totalSuccess = 0;
    let totalFailure = 0;

    for (const config of providerConfigs) {
      if (!config.available || !config.client) {
        console.log(
          `[sandboxMaintenance:pause] Skipping ${config.provider}: ${config.error}`
        );
        continue;
      }

      console.log(
        `[sandboxMaintenance:pause] Processing provider: ${config.provider}`
      );

      try {
        const instances = await config.client.listInstances();

        // Filter for cmux instances that are ready/running and older than threshold
        const staleInstances = instances
          .filter((inst) => inst.metadata?.app?.startsWith("cmux"))
          .filter((inst) => inst.status === "ready" || inst.status === "running")
          .filter((inst) => {
            // For PVE, check activity table since PVE doesn't track creation time
            if (inst.created === 0) {
              // Will be checked via activity table below
              return true;
            }
            const createdMs = inst.created * 1000;
            return now - createdMs > thresholdMs;
          })
          .sort((a, b) => a.created - b.created);

        if (staleInstances.length === 0) {
          console.log(
            `[sandboxMaintenance:pause] No stale instances for ${config.provider}`
          );
          continue;
        }

        // For PVE, we need to check activity table for creation time
        if (config.provider === "pve-lxc") {
          const instanceIds = staleInstances.map((i) => i.id);
          const activities = await ctx.runQuery(
            internal.sandboxInstances.getActivitiesByInstanceIdsInternal,
            { instanceIds }
          );

          // Filter based on activity creation time
          const filteredStale = staleInstances.filter((inst) => {
            const activity = activities[inst.id];
            if (!activity?.createdAt) return true; // No record, assume old
            return now - activity.createdAt > thresholdMs;
          });

          if (filteredStale.length === 0) {
            console.log(
              `[sandboxMaintenance:pause] No stale PVE instances after activity check`
            );
            continue;
          }
        }

        console.log(
          `[sandboxMaintenance:pause] Found ${staleInstances.length} stale ${config.provider} instances`
        );

        // Process in batches
        for (let i = 0; i < staleInstances.length; i += BATCH_SIZE) {
          const batch = staleInstances.slice(i, i + BATCH_SIZE);

          const results = await Promise.allSettled(
            batch.map(async (instance) => {
              const ageHours =
                instance.created > 0
                  ? Math.floor(
                      (now - instance.created * 1000) / MILLISECONDS_PER_HOUR
                    )
                  : "unknown";

              console.log(
                `[sandboxMaintenance:pause] Pausing ${instance.id} (${ageHours}h old)...`
              );

              await config.client!.pauseInstance(instance.id);

              // Record in activity table
              await ctx.runMutation(
                internal.sandboxInstances.recordPauseInternal,
                {
                  instanceId: instance.id,
                  provider: config.provider,
                }
              );

              console.log(
                `[sandboxMaintenance:pause] Paused ${instance.id}`
              );
              return instance.id;
            })
          );

          for (const result of results) {
            if (result.status === "fulfilled") {
              totalSuccess++;
            } else {
              totalFailure++;
              console.error(
                `[sandboxMaintenance:pause] Failed to pause instance:`,
                result.reason
              );
            }
          }
        }
      } catch (error) {
        console.error(
          `[sandboxMaintenance:pause] Error processing ${config.provider}:`,
          error
        );
      }
    }

    console.log(
      `[sandboxMaintenance:pause] Finished: ${totalSuccess} paused, ${totalFailure} failed`
    );
  },
});

/**
 * Stops (deletes) sandbox instances that have been inactive for more than the threshold.
 * Called by the daily cron job.
 */
export const stopOldSandboxInstances = internalAction({
  args: {},
  handler: async (ctx) => {
    // Only run in production
    if (!env.CONVEX_IS_PRODUCTION) {
      console.log("[sandboxMaintenance:stop] Skipping: not in production");
      return;
    }

    const providerConfigs = getProviderConfigs();
    const now = Date.now();
    const thresholdMs = STOP_DAYS_THRESHOLD * 24 * MILLISECONDS_PER_HOUR;

    let totalSuccess = 0;
    let totalFailure = 0;
    let totalSkipped = 0;

    for (const config of providerConfigs) {
      if (!config.available || !config.client) {
        console.log(
          `[sandboxMaintenance:stop] Skipping ${config.provider}: ${config.error}`
        );
        continue;
      }

      console.log(
        `[sandboxMaintenance:stop] Processing provider: ${config.provider}`
      );

      try {
        const instances = await config.client.listInstances();

        // Filter for cmux instances that are paused/stopped
        const pausedInstances = instances
          .filter((inst) => inst.metadata?.app?.startsWith("cmux"))
          .filter(
            (inst) => inst.status === "paused" || inst.status === "stopped"
          );

        if (pausedInstances.length === 0) {
          console.log(
            `[sandboxMaintenance:stop] No paused instances for ${config.provider}`
          );
          continue;
        }

        console.log(
          `[sandboxMaintenance:stop] Checking ${pausedInstances.length} paused ${config.provider} instances`
        );

        // Get activity records for all instances
        const instanceIds = pausedInstances.map((i) => i.id);
        const activities = await ctx.runQuery(
          internal.sandboxInstances.getActivitiesByInstanceIdsInternal,
          { instanceIds }
        );

        // Process in batches
        for (let i = 0; i < pausedInstances.length; i += BATCH_SIZE) {
          const batch = pausedInstances.slice(i, i + BATCH_SIZE);

          const results = await Promise.allSettled(
            batch.map(async (instance) => {
              const activity = activities[instance.id];

              // Already stopped?
              if (activity?.stoppedAt) {
                console.log(
                  `[sandboxMaintenance:stop] Skipping ${instance.id} - already recorded as stopped`
                );
                return { skipped: true, reason: "already_stopped" };
              }

              // Determine last activity time
              const lastActivityAt =
                activity?.lastResumedAt ??
                activity?.lastPausedAt ??
                activity?.createdAt ??
                instance.created * 1000;

              const inactiveDuration = now - lastActivityAt;
              const inactiveDays = Math.floor(
                inactiveDuration / (24 * MILLISECONDS_PER_HOUR)
              );

              if (inactiveDuration < thresholdMs) {
                console.log(
                  `[sandboxMaintenance:stop] Skipping ${instance.id} - last activity ${inactiveDays} days ago`
                );
                return { skipped: true, reason: "recently_active" };
              }

              console.log(
                `[sandboxMaintenance:stop] Stopping ${instance.id} (inactive ${inactiveDays} days)...`
              );

              await config.client!.stopInstance(instance.id);

              // Record in activity table
              await ctx.runMutation(
                internal.sandboxInstances.recordStopInternal,
                {
                  instanceId: instance.id,
                  provider: config.provider,
                }
              );

              console.log(
                `[sandboxMaintenance:stop] Stopped ${instance.id}`
              );
              return { skipped: false };
            })
          );

          for (const result of results) {
            if (result.status === "fulfilled") {
              if (result.value.skipped) {
                totalSkipped++;
              } else {
                totalSuccess++;
              }
            } else {
              totalFailure++;
              console.error(
                `[sandboxMaintenance:stop] Failed to stop instance:`,
                result.reason
              );
            }
          }
        }
      } catch (error) {
        console.error(
          `[sandboxMaintenance:stop] Error processing ${config.provider}:`,
          error
        );
      }
    }

    console.log(
      `[sandboxMaintenance:stop] Finished: ${totalSuccess} stopped, ${totalSkipped} skipped, ${totalFailure} failed`
    );
  },
});

// ============================================================================
// Orphan Container Cleanup (Garbage Collection)
// ============================================================================

/**
 * Clean up orphaned containers that exist in the provider but have no
 * corresponding Convex sandboxInstanceActivity record.
 *
 * This handles cases where:
 * - Container was created but server crashed before recording to Convex
 * - Manual container creation on PVE that shouldn't exist
 * - Stale containers from failed cleanup attempts
 *
 * Safety measures:
 * - Only processes containers with "cmux-" hostname prefix
 * - Requires container to be stopped (not running)
 * - Logs all actions for audit purposes
 */
export const cleanupOrphanedContainers = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[sandboxMaintenance:orphanCleanup] Starting orphan cleanup...");

    const configs = getProviderConfigs();
    let totalCleaned = 0;
    let totalSkipped = 0;

    for (const config of configs) {
      if (!config.available || !config.client) {
        console.log(
          `[sandboxMaintenance:orphanCleanup] Skipping ${config.provider}: not available`
        );
        continue;
      }

      try {
        // Get all instances from provider
        const instances = await config.client.listInstances();
        console.log(
          `[sandboxMaintenance:orphanCleanup] ${config.provider}: Found ${instances.length} instances`
        );

        if (instances.length === 0) continue;

        // Get activity records for these instances from Convex
        const instanceIds = instances.map((i) => i.id);
        const activities = await ctx.runQuery(
          internal.sandboxInstances.getActivitiesByInstanceIdsInternal,
          { instanceIds }
        );

        // Find orphans: instances with no activity record
        const orphans = instances.filter((inst) => !activities[inst.id]);

        console.log(
          `[sandboxMaintenance:orphanCleanup] ${config.provider}: Found ${orphans.length} orphaned instances`
        );

        for (const orphan of orphans) {
          // Safety: only clean up stopped containers
          // "ready" is Morph's term for running, PVE uses status directly
          if (orphan.status === "ready" || orphan.status === "running") {
            console.log(
              `[sandboxMaintenance:orphanCleanup] Skipping running orphan: ${orphan.id}`
            );
            totalSkipped++;
            continue;
          }

          try {
            console.log(
              `[sandboxMaintenance:orphanCleanup] Deleting orphan: ${orphan.id} (status=${orphan.status})`
            );
            await config.client.stopInstance(orphan.id);
            totalCleaned++;
          } catch (error) {
            console.error(
              `[sandboxMaintenance:orphanCleanup] Failed to delete ${orphan.id}:`,
              error
            );
          }
        }
      } catch (error) {
        console.error(
          `[sandboxMaintenance:orphanCleanup] Error processing ${config.provider}:`,
          error
        );
      }
    }

    console.log(
      `[sandboxMaintenance:orphanCleanup] Finished: ${totalCleaned} cleaned, ${totalSkipped} skipped`
    );
  },
});
