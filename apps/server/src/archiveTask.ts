import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import type { VSCodeProvider } from "@cmux/shared/provider-types";
import type { FunctionReturnType } from "convex/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getConvex } from "./utils/convexClient";
import { serverLogger } from "./utils/fileLogger";
import { getAuthHeaderJson, getAuthToken } from "./utils/requestContext";
import { getWwwBaseUrl } from "./utils/server-env";

const execAsync = promisify(exec);

// Port mapping interface for Docker containers
interface DockerPortMapping {
  vscode: string;
  worker: string;
  proxy: string;
  vnc: string;
}

export type { VSCodeProvider };

export interface StopResult {
  success: boolean;
  containerName: string;
  provider: VSCodeProvider;
  error?: unknown;
}

export interface ResumeResult {
  success: boolean;
  containerName: string;
  provider: VSCodeProvider;
  error?: unknown;
}

async function stopDockerContainer(containerName: string): Promise<void> {
  try {
    await execAsync(`docker stop ${containerName}`, { timeout: 15_000 });
    return;
  } catch (err) {
    // If docker stop failed, check if it's already exited/stopped
    try {
      const { stdout } = await execAsync(
        `docker ps -a --filter "name=^${containerName}$" --format "{{.Status}}"`
      );
      if (stdout.toLowerCase().includes("exited")) {
        // Consider success if the container is already stopped
        return;
      }
    } catch {
      // ignore check errors and rethrow original
    }
    throw err;
  }
}

async function stopCmuxSandbox(instanceId: string): Promise<void> {
  const baseUrl = getWwwBaseUrl();
  const url = `${baseUrl}/api/sandboxes/${encodeURIComponent(instanceId)}/stop`;
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers["x-stack-auth"] =
      getAuthHeaderJson() || JSON.stringify({ accessToken: token });
  }
  const res = await fetch(url, { method: "POST", headers });
  if (!res.ok && res.status !== 204) {
    throw new Error(
      `Failed stopping sandbox ${instanceId}: HTTP ${res.status}`
    );
  }
}

async function startDockerContainer(containerName: string): Promise<void> {
  await execAsync(`docker start ${containerName}`, { timeout: 15_000 });
}

/**
 * Get port mappings from a running Docker container.
 * Uses docker inspect to retrieve the dynamically assigned host ports.
 * Resilient: retries up to 3 times with exponential backoff.
 */
async function getDockerContainerPorts(
  containerName: string,
  maxRetries = 3
): Promise<DockerPortMapping | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { stdout } = await execAsync(
        `docker inspect ${containerName} --format '{{json .NetworkSettings.Ports}}'`,
        { timeout: 10_000 }
      );

      const ports = JSON.parse(stdout.trim()) as Record<
        string,
        Array<{ HostIp: string; HostPort: string }> | null
      >;

      const vscodePort = ports["39378/tcp"]?.[0]?.HostPort;
      const workerPort = ports["39377/tcp"]?.[0]?.HostPort;
      const proxyPort = ports["39379/tcp"]?.[0]?.HostPort;
      const vncPort = ports["39380/tcp"]?.[0]?.HostPort;

      if (!vscodePort || !workerPort || !proxyPort || !vncPort) {
        serverLogger.warn(
          `[getDockerContainerPorts] Missing ports for ${containerName} (attempt ${attempt}):`,
          { vscodePort, workerPort, proxyPort, vncPort }
        );
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        return null;
      }

      return { vscode: vscodePort, worker: workerPort, proxy: proxyPort, vnc: vncPort };
    } catch (error) {
      serverLogger.error(
        `[getDockerContainerPorts] Failed to inspect ${containerName} (attempt ${attempt}):`,
        error
      );
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  return null;
}

/**
 * Update Convex with new port mappings and status after container resume.
 * Resilient: catches errors and logs them without failing the resume operation.
 */
async function updateConvexAfterResume(
  runId: string,
  teamSlugOrId: string,
  ports: DockerPortMapping
): Promise<boolean> {
  try {
    // Update ports
    await getConvex().mutation(api.taskRuns.updateVSCodePorts, {
      teamSlugOrId,
      id: runId as Id<"taskRuns">,
      ports: {
        vscode: ports.vscode,
        worker: ports.worker,
        proxy: ports.proxy,
        vnc: ports.vnc,
      },
    });

    // Update status to running
    await getConvex().mutation(api.taskRuns.updateVSCodeStatus, {
      teamSlugOrId,
      id: runId as Id<"taskRuns">,
      status: "running",
    });

    serverLogger.info(
      `[updateConvexAfterResume] Updated Convex for run ${runId} with ports:`,
      ports
    );
    return true;
  } catch (error) {
    serverLogger.error(
      `[updateConvexAfterResume] Failed to update Convex for run ${runId}:`,
      error
    );
    return false;
  }
}

async function resumeCmuxSandbox(
  instanceId: string,
  teamSlugOrId: string
): Promise<void> {
  const baseUrl = getWwwBaseUrl();
  const url = `${baseUrl}/api/sandboxes/${encodeURIComponent(instanceId)}/resume?teamSlugOrId=${encodeURIComponent(teamSlugOrId)}`;
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers["x-stack-auth"] =
      getAuthHeaderJson() || JSON.stringify({ accessToken: token });
  }
  const res = await fetch(url, { method: "POST", headers });
  if (!res.ok && res.status !== 204) {
    throw new Error(
      `Failed resuming sandbox ${instanceId}: HTTP ${res.status}`
    );
  }
}

export async function stopContainersForRuns(
  taskId: Id<"tasks">,
  teamSlugOrId: string,
  query: (
    ref: typeof api.taskRuns.getByTask,
    args: { teamSlugOrId: string; taskId: Id<"tasks"> }
  ) => Promise<FunctionReturnType<typeof api.taskRuns.getByTask>> = (
    ref,
    args
  ) => getConvex().query(ref, args)
): Promise<StopResult[]> {
  const tree = await query(api.taskRuns.getByTask, {
    teamSlugOrId,
    taskId,
  });
  return stopContainersForRunsFromTree(tree, String(taskId));
}

export function stopContainersForRunsFromTree(
  tree: FunctionReturnType<typeof api.taskRuns.getByTask>,
  taskIdLabel?: string
): Promise<StopResult[]> {
  // Flatten tree without casts
  const flat: unknown[] = [];
  const walk = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      flat.push(n);
      if (typeof n === "object" && n !== null) {
        const children = Reflect.get(Object(n), "children");
        walk(children);
      }
    }
  };
  walk(tree);

  if (typeof taskIdLabel === "string") {
    serverLogger.info(`Archiving task ${taskIdLabel} with ${flat.length} runs`);
  }

  // Collect valid docker/morph targets
  const targets: {
    provider: VSCodeProvider;
    containerName: string;
    runId: string;
  }[] = [];
  for (const r of flat) {
    if (typeof r !== "object" || r === null) continue;
    const vscode = Reflect.get(Object(r), "vscode");
    const runId = Reflect.get(Object(r), "_id");
    const provider =
      typeof vscode === "object" && vscode !== null
        ? Reflect.get(Object(vscode), "provider")
        : undefined;
    const name =
      typeof vscode === "object" && vscode !== null
        ? Reflect.get(Object(vscode), "containerName")
        : undefined;

    if (
      provider === "docker" &&
      typeof name === "string" &&
      typeof runId === "string"
    ) {
      targets.push({ provider: "docker", containerName: name, runId });
    } else if (
      provider === "morph" &&
      typeof name === "string" &&
      typeof runId === "string"
    ) {
      targets.push({ provider: "morph", containerName: name, runId });
    } else if (
      provider === "pve-lxc" &&
      typeof name === "string" &&
      typeof runId === "string"
    ) {
      targets.push({ provider: "pve-lxc", containerName: name, runId });
    }
  }

  return Promise.all(
    targets.map(async (t): Promise<StopResult> => {
      try {
        serverLogger.info(
          `Stopping ${t.provider} container for run ${t.runId}: ${t.containerName}`
        );
        if (t.provider === "docker") {
          // Remove 'docker-' prefix for actual Docker commands
          const actualContainerName = t.containerName.startsWith("docker-")
            ? t.containerName.substring(7)
            : t.containerName;
          await stopDockerContainer(actualContainerName);
          serverLogger.info(
            `Successfully stopped Docker container: ${t.containerName} (actual: ${actualContainerName})`
          );
          return {
            success: true,
            containerName: t.containerName,
            provider: t.provider,
          };
        }
        if (t.provider === "morph") {
          await stopCmuxSandbox(t.containerName);
          serverLogger.info(
            `Successfully paused Morph instance: ${t.containerName}`
          );
          return {
            success: true,
            containerName: t.containerName,
            provider: t.provider,
          };
        }
        if (t.provider === "pve-lxc") {
          // PVE LXC uses the same sandbox API endpoint as Morph
          // Note: LXC doesn't support hibernate, so containers are stopped (not paused)
          await stopCmuxSandbox(t.containerName);
          serverLogger.info(
            `Successfully stopped PVE LXC instance: ${t.containerName}`
          );
          return {
            success: true,
            containerName: t.containerName,
            provider: t.provider,
          };
        }
        serverLogger.warn(
          `Unsupported provider '${t.provider}' for container ${t.containerName}`
        );
        return {
          success: false,
          containerName: t.containerName,
          provider: t.provider,
          error: new Error("Unsupported provider"),
        };
      } catch (error) {
        serverLogger.error(
          `Failed to stop ${t.provider} container ${t.containerName}:`,
          error
        );
        return {
          success: false,
          containerName: t.containerName,
          provider: t.provider,
          error,
        };
      }
    })
  );
}

export async function resumeContainersForRuns(
  taskId: Id<"tasks">,
  teamSlugOrId: string,
  query: (
    ref: typeof api.taskRuns.getByTask,
    args: { teamSlugOrId: string; taskId: Id<"tasks"> }
  ) => Promise<FunctionReturnType<typeof api.taskRuns.getByTask>> = (
    ref,
    args
  ) => getConvex().query(ref, args)
): Promise<ResumeResult[]> {
  const tree = await query(api.taskRuns.getByTask, {
    teamSlugOrId,
    taskId,
  });
  return resumeContainersForRunsFromTree(tree, teamSlugOrId, String(taskId));
}

export function resumeContainersForRunsFromTree(
  tree: FunctionReturnType<typeof api.taskRuns.getByTask>,
  teamSlugOrId: string,
  taskIdLabel?: string
): Promise<ResumeResult[]> {
  // Flatten tree without casts
  const flat: unknown[] = [];
  const walk = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      flat.push(n);
      if (typeof n === "object" && n !== null) {
        const children = Reflect.get(Object(n), "children");
        walk(children);
      }
    }
  };
  walk(tree);

  if (typeof taskIdLabel === "string") {
    serverLogger.info(`Resuming task ${taskIdLabel} with ${flat.length} runs`);
  }

  // Collect valid docker/morph targets
  const targets: {
    provider: VSCodeProvider;
    containerName: string;
    runId: string;
  }[] = [];
  for (const r of flat) {
    if (typeof r !== "object" || r === null) continue;
    const vscode = Reflect.get(Object(r), "vscode");
    const runId = Reflect.get(Object(r), "_id");
    const provider =
      typeof vscode === "object" && vscode !== null
        ? Reflect.get(Object(vscode), "provider")
        : undefined;
    const name =
      typeof vscode === "object" && vscode !== null
        ? Reflect.get(Object(vscode), "containerName")
        : undefined;

    if (
      provider === "docker" &&
      typeof name === "string" &&
      typeof runId === "string"
    ) {
      targets.push({ provider: "docker", containerName: name, runId });
    } else if (
      provider === "morph" &&
      typeof name === "string" &&
      typeof runId === "string"
    ) {
      targets.push({ provider: "morph", containerName: name, runId });
    } else if (
      provider === "pve-lxc" &&
      typeof name === "string" &&
      typeof runId === "string"
    ) {
      targets.push({ provider: "pve-lxc", containerName: name, runId });
    }
  }

  return Promise.all(
    targets.map(async (t): Promise<ResumeResult> => {
      try {
        serverLogger.info(
          `Resuming ${t.provider} container for run ${t.runId}: ${t.containerName}`
        );
        if (t.provider === "docker") {
          // Remove 'docker-' prefix for actual Docker commands
          const actualContainerName = t.containerName.startsWith("docker-")
            ? t.containerName.substring(7)
            : t.containerName;
          await startDockerContainer(actualContainerName);
          serverLogger.info(
            `Successfully started Docker container: ${t.containerName} (actual: ${actualContainerName})`
          );

          // Get new port mappings after container restart
          // Docker assigns new random ports when container restarts with HostPort: "0"
          const newPorts = await getDockerContainerPorts(actualContainerName);
          if (newPorts) {
            serverLogger.info(
              `[resume] Got new ports for ${actualContainerName}:`,
              newPorts
            );
            // Update Convex with new ports (non-blocking, errors are logged)
            const convexUpdated = await updateConvexAfterResume(
              t.runId,
              teamSlugOrId,
              newPorts
            );
            if (!convexUpdated) {
              serverLogger.warn(
                `[resume] Convex update failed for ${actualContainerName}, container is running but ports may be stale`
              );
            }
          } else {
            serverLogger.warn(
              `[resume] Could not get new ports for ${actualContainerName}, Convex ports may be stale`
            );
          }

          return {
            success: true,
            containerName: t.containerName,
            provider: t.provider,
          };
        }
        if (t.provider === "morph") {
          await resumeCmuxSandbox(t.containerName, teamSlugOrId);
          serverLogger.info(
            `Successfully resumed Morph instance: ${t.containerName}`
          );
          return {
            success: true,
            containerName: t.containerName,
            provider: t.provider,
          };
        }
        if (t.provider === "pve-lxc") {
          // PVE LXC uses the same sandbox API endpoint as Morph
          // Note: LXC containers are restarted (not resumed from hibernate)
          await resumeCmuxSandbox(t.containerName, teamSlugOrId);
          serverLogger.info(
            `Successfully started PVE LXC instance: ${t.containerName}`
          );
          return {
            success: true,
            containerName: t.containerName,
            provider: t.provider,
          };
        }
        serverLogger.warn(
          `Unsupported provider '${t.provider}' for container ${t.containerName}`
        );
        return {
          success: false,
          containerName: t.containerName,
          provider: t.provider,
          error: new Error("Unsupported provider"),
        };
      } catch (error) {
        serverLogger.error(
          `Failed to resume ${t.provider} container ${t.containerName}:`,
          error
        );
        return {
          success: false,
          containerName: t.containerName,
          provider: t.provider,
          error,
        };
      }
    })
  );
}
