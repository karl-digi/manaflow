/**
 * Proxmox VE LXC Client
 *
 * A client for managing LXC containers on Proxmox VE that mirrors
 * the MorphCloudClient interface for seamless provider switching.
 */

import { env } from "./www-env";
import { spawn } from "node:child_process";
import { Agent, fetch as undiciFetch } from "undici";

// PVE often uses self-signed certificates, so we need a custom agent
// We use undici's fetch directly to ensure the dispatcher option works
// (Next.js patches global fetch which may not support dispatcher)
const pveHttpsAgent = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

/**
 * Result of command execution
 */
export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

/**
 * HTTP service exposed by the container
 */
export interface HttpService {
  name: string;
  port: number;
  url: string;
}

/**
 * Container networking configuration
 */
export interface ContainerNetworking {
  httpServices: HttpService[];
  ipAddress?: string;
}

/**
 * Container instance metadata
 */
export interface ContainerMetadata {
  app?: string;
  teamId?: string;
  userId?: string;
  environmentId?: string;
  [key: string]: string | undefined;
}

/**
 * Container status
 */
export type ContainerStatus = "running" | "stopped" | "paused" | "unknown";

/**
 * PVE LXC Container Instance
 */
export class PveLxcInstance {
  public readonly id: string;
  public readonly vmid: number;
  public status: ContainerStatus;
  public metadata: ContainerMetadata;
  public networking: ContainerNetworking;

  private client: PveLxcClient;
  private node: string;
  private sshHost: string;

  constructor(
    client: PveLxcClient,
    vmid: number,
    status: ContainerStatus,
    metadata: ContainerMetadata,
    networking: ContainerNetworking,
    node: string,
    sshHost: string
  ) {
    this.client = client;
    this.vmid = vmid;
    this.id = `pve_lxc_${vmid}`;
    this.status = status;
    this.metadata = metadata;
    this.networking = networking;
    this.node = node;
    this.sshHost = sshHost;
  }

  /**
   * Execute a command inside the container.
   * Tries HTTP exec first (via cmux-execd), falls back to SSH + pct exec.
   */
  async exec(command: string, options?: { timeoutMs?: number }): Promise<ExecResult> {
    return this.client.execInContainer(this.vmid, command, {
      ipAddress: this.networking.ipAddress,
      timeoutMs: options?.timeoutMs,
    });
  }

  /**
   * Start the container
   */
  async start(): Promise<void> {
    await this.client.startContainer(this.vmid);
    this.status = "running";
  }

  /**
   * Stop the container
   */
  async stop(): Promise<void> {
    await this.client.stopContainer(this.vmid);
    this.status = "stopped";
  }

  /**
   * Pause the container (PVE uses freeze for LXC)
   */
  async pause(): Promise<void> {
    await this.client.suspendContainer(this.vmid);
    this.status = "paused";
  }

  /**
   * Resume the container
   */
  async resume(): Promise<void> {
    await this.client.resumeContainer(this.vmid);
    this.status = "running";
  }

  /**
   * Expose an HTTP service (stores in metadata, actual exposure via IP)
   */
  async exposeHttpService(name: string, port: number): Promise<void> {
    // For PVE LXC, we expose services via direct container IP
    const ipAddress = this.networking.ipAddress;
    if (!ipAddress) {
      throw new Error("Container IP address not available");
    }

    const url = `http://${ipAddress}:${port}`;
    const existingService = this.networking.httpServices.find(
      (s) => s.name === name
    );
    if (existingService) {
      existingService.port = port;
      existingService.url = url;
    } else {
      this.networking.httpServices.push({ name, port, url });
    }
  }

  /**
   * Hide an HTTP service
   */
  async hideHttpService(name: string): Promise<void> {
    this.networking.httpServices = this.networking.httpServices.filter(
      (s) => s.name !== name
    );
  }

  /**
   * Set wake-on behavior (no-op for PVE, compatibility with Morph)
   */
  async setWakeOn(_http: boolean, _ssh: boolean): Promise<void> {
    // PVE LXC doesn't have wake-on functionality like Morph
    // This is a no-op for compatibility
  }
}

/**
 * Options for starting a container
 */
export interface StartContainerOptions {
  snapshotId: string;
  ttlSeconds?: number;
  ttlAction?: "pause" | "stop";
  metadata?: ContainerMetadata;
}

/**
 * PVE API response types
 */
interface PveApiResponse<T> {
  data: T;
}

interface PveTaskStatus {
  status: string;
  exitstatus?: string;
}

interface PveContainerStatus {
  status: string;
  vmid: number;
  name?: string;
  cpus?: number;
  maxmem?: number;
  maxdisk?: number;
}

interface PveContainerConfig {
  hostname?: string;
  cores?: number;
  memory?: number;
  net0?: string;
  rootfs?: string;
  description?: string;
}

/**
 * Proxmox VE LXC Client
 */
export class PveLxcClient {
  private apiUrl: string;
  private apiToken: string;
  private node: string | null;
  private sshHost: string;

  // In-memory store for instance metadata (PVE doesn't have native metadata support)
  private instanceMetadata: Map<number, ContainerMetadata> = new Map();
  private instanceServices: Map<number, HttpService[]> = new Map();

  constructor(options: {
    apiUrl: string;
    apiToken: string;
    node?: string;
  }) {
    this.apiUrl = options.apiUrl.replace(/\/$/, "");
    this.apiToken = options.apiToken;
    this.node = options.node || null; // Will be auto-detected if not provided

    // Extract SSH host from API URL
    const url = new URL(this.apiUrl);
    this.sshHost = `root@${url.hostname}`;
  }

  /**
   * Get the target node (auto-detect if not set)
   */
  private async getNode(): Promise<string> {
    if (this.node) {
      return this.node;
    }
    // Auto-detect by querying /nodes endpoint
    const result = await this.apiRequest<Array<{ node: string }>>(
      "GET",
      "/api2/json/nodes"
    );
    if (!result || result.length === 0) {
      throw new Error("No nodes found in PVE cluster");
    }
    this.node = result[0].node;
    console.log(`[PveLxcClient] Auto-detected node: ${this.node}`);
    return this.node;
  }

  /**
   * Make an API request to PVE
   */
  private async apiRequest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `PVEAPIToken=${this.apiToken}`,
    };

    let requestBody: string | undefined;
    if (body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      requestBody = new URLSearchParams(
        Object.entries(body).map(([k, v]) => [k, String(v)])
      ).toString();
    }

    // Use undici's fetch directly to ensure dispatcher option works
    // (Next.js patches global fetch which ignores dispatcher)
    const response = await undiciFetch(url, {
      method,
      headers,
      body: requestBody,
      dispatcher: pveHttpsAgent,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`PVE API error ${response.status}: ${text}`);
    }

    const json = (await response.json()) as PveApiResponse<T>;
    return json.data;
  }

  /**
   * Wait for a PVE task to complete
   */
  private async waitForTask(
    upid: string,
    timeoutMs: number = 300000
  ): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 2000;
    const node = await this.getNode();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.apiRequest<PveTaskStatus>(
        "GET",
        `/api2/json/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`
      );

      if (status.status === "stopped") {
        if (status.exitstatus !== "OK") {
          throw new Error(`Task failed: ${status.exitstatus}`);
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error("Task timeout");
  }

  /**
   * Execute a command on the PVE host via SSH
   */
  private async sshExec(command: string): Promise<ExecResult> {
    return new Promise((resolve) => {
      const sshArgs = [
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "ConnectTimeout=10",
        this.sshHost,
        command,
      ];

      const proc = spawn("ssh", sshArgs);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({
          exit_code: code ?? 1,
          stdout,
          stderr,
        });
      });

      proc.on("error", (err) => {
        resolve({
          exit_code: 1,
          stdout: "",
          stderr: err.message,
        });
      });
    });
  }

  /**
   * Execute a command inside an LXC container via HTTP exec daemon.
   * This uses the cmux-execd service running in the container on port 39375.
   * Returns null if HTTP exec is not available.
   */
  private async httpExec(
    ipAddress: string,
    command: string,
    timeoutMs?: number
  ): Promise<ExecResult | null> {
    const execUrl = `http://${ipAddress}:39375/exec`;
    const body = JSON.stringify({
      command: `bash -lc ${JSON.stringify(command)}`,
      timeout_ms: timeoutMs ?? 30000,
    });

    try {
      const response = await undiciFetch(execUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(timeoutMs ?? 60000),
      });

      if (!response.ok) {
        return null;
      }

      // Parse streaming JSON lines response
      const text = await response.text();
      const lines = text.trim().split("\n").filter(Boolean);

      let stdout = "";
      let stderr = "";
      let exitCode = 0;

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as {
            type: string;
            data?: string;
            code?: number;
            message?: string;
          };

          switch (event.type) {
            case "stdout":
              if (event.data) stdout += event.data + "\n";
              break;
            case "stderr":
              if (event.data) stderr += event.data + "\n";
              break;
            case "exit":
              exitCode = event.code ?? 0;
              break;
            case "error":
              stderr += (event.message ?? "Unknown error") + "\n";
              break;
          }
        } catch {
          // Skip malformed lines
        }
      }

      return {
        exit_code: exitCode,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
      };
    } catch (error) {
      // HTTP exec not available, will fall back to SSH
      console.log(
        `[PveLxcClient] HTTP exec failed for ${ipAddress}, falling back to SSH:`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Execute a command inside an LXC container.
   * Tries HTTP exec first (via cmux-execd), falls back to SSH + pct exec.
   */
  async execInContainer(
    vmid: number,
    command: string,
    options?: { ipAddress?: string; timeoutMs?: number }
  ): Promise<ExecResult> {
    // Try HTTP exec first if we have the IP address
    const ipAddress = options?.ipAddress;
    if (ipAddress) {
      const httpResult = await this.httpExec(
        ipAddress,
        command,
        options?.timeoutMs
      );
      if (httpResult) {
        return httpResult;
      }
    }

    // Fall back to SSH + pct exec
    const escapedCommand = command.replace(/'/g, "'\\''");
    const pctCommand = `pct exec ${vmid} -- bash -lc '${escapedCommand}'`;
    return this.sshExec(pctCommand);
  }

  /**
   * Get the next available VMID (checks both QEMU VMs and LXC containers)
   */
  private async findNextVmid(): Promise<number> {
    const node = await this.getNode();

    // Get LXC containers
    const containers = await this.apiRequest<PveContainerStatus[]>(
      "GET",
      `/api2/json/nodes/${node}/lxc`
    );

    // Get QEMU VMs as well to avoid VMID collisions
    const vms = await this.apiRequest<Array<{ vmid: number }>>(
      "GET",
      `/api2/json/nodes/${node}/qemu`
    );

    const usedVmids = new Set([
      ...containers.map((c) => c.vmid),
      ...vms.map((v) => v.vmid),
    ]);

    // Start from 200 to avoid collision with typical template VMIDs (100-199)
    let vmid = 200;
    while (usedVmids.has(vmid)) {
      vmid++;
    }
    return vmid;
  }

  /**
   * Get container IP address from network config
   * For DHCP containers, waits for the lease to be acquired with retries
   */
  private async getContainerIp(
    vmid: number,
    options: { maxRetries?: number; retryDelayMs?: number } = {}
  ): Promise<string | undefined> {
    const { maxRetries = 10, retryDelayMs = 2000 } = options;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const node = await this.getNode();
        const config = await this.apiRequest<PveContainerConfig>(
          "GET",
          `/api2/json/nodes/${node}/lxc/${vmid}/config`
        );

        // Parse IP from net0 config (format: name=eth0,bridge=vmbr0,ip=10.0.0.x/24,...)
        // Skip if ip=dhcp - need to get actual IP from container
        if (config.net0) {
          const ipMatch = config.net0.match(/ip=([^/,]+)/);
          if (ipMatch && ipMatch[1] !== "dhcp") {
            // Static IP configured, return it
            return ipMatch[1];
          }
        }

        // For DHCP or when static IP not found, try to get IP from container via exec
        const result = await this.execInContainer(
          vmid,
          "hostname -I | awk '{print $1}'"
        );
        if (result.exit_code === 0 && result.stdout.trim()) {
          const ip = result.stdout.trim();
          // Validate it looks like an IP address (not empty or "dhcp")
          if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
            return ip;
          }
        }

        // IP not ready yet, wait and retry
        if (attempt < maxRetries - 1) {
          console.log(
            `[PveLxcClient] Waiting for container ${vmid} IP (attempt ${attempt + 1}/${maxRetries})...`
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      } catch (error) {
        console.error(
          `[PveLxcClient] Error getting IP for container ${vmid}:`,
          error
        );
        // On error, wait and retry
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    console.warn(
      `[PveLxcClient] Failed to get IP for container ${vmid} after ${maxRetries} attempts`
    );
    return undefined;
  }

  /**
   * Parse snapshot/template ID to extract template VMID.
   * Schema v2 format: pve_template_{templateVmid}
   */
  private parseSnapshotId(snapshotId: string): {
    templateVmid: number;
  } {
    // Schema v2 format: pve_template_{templateVmid}
    const match = snapshotId.match(/^pve_template_(\d+)$/);
    if (!match) {
      throw new Error(
        `Invalid PVE template ID format: ${snapshotId}. ` +
        `Expected format: pve_template_{templateVmid}`
      );
    }
    return {
      templateVmid: parseInt(match[1], 10),
    };
  }

  /**
   * Clone a container from a template using linked-clone (fast, copy-on-write).
   * Requires the source to be a template (template=1 in PVE config).
   */
  private async linkedCloneFromTemplate(
    templateVmid: number,
    newVmid: number,
    hostname: string
  ): Promise<void> {
    const node = await this.getNode();
    const upid = await this.apiRequest<string>(
      "POST",
      `/api2/json/nodes/${node}/lxc/${templateVmid}/clone`,
      {
        newid: newVmid,
        hostname,
        full: 0, // Linked clone (fast, copy-on-write)
      }
    );

    await this.waitForTask(upid);
  }

  /**
   * Start a container
   */
  async startContainer(vmid: number): Promise<void> {
    const node = await this.getNode();
    const upid = await this.apiRequest<string>(
      "POST",
      `/api2/json/nodes/${node}/lxc/${vmid}/status/start`
    );
    await this.waitForTask(upid);
  }

  /**
   * Stop a container
   */
  async stopContainer(vmid: number): Promise<void> {
    const node = await this.getNode();
    const upid = await this.apiRequest<string>(
      "POST",
      `/api2/json/nodes/${node}/lxc/${vmid}/status/stop`
    );
    await this.waitForTask(upid);
  }

  /**
   * Suspend (freeze) a container
   */
  async suspendContainer(vmid: number): Promise<void> {
    const node = await this.getNode();
    const upid = await this.apiRequest<string>(
      "POST",
      `/api2/json/nodes/${node}/lxc/${vmid}/status/suspend`
    );
    await this.waitForTask(upid);
  }

  /**
   * Resume a suspended container
   */
  async resumeContainer(vmid: number): Promise<void> {
    const node = await this.getNode();
    const upid = await this.apiRequest<string>(
      "POST",
      `/api2/json/nodes/${node}/lxc/${vmid}/status/resume`
    );
    await this.waitForTask(upid);
  }

  /**
   * Delete a container
   */
  async deleteContainer(vmid: number): Promise<void> {
    // Stop first if running
    try {
      await this.stopContainer(vmid);
    } catch {
      // May already be stopped
    }

    const node = await this.getNode();
    const upid = await this.apiRequest<string>(
      "DELETE",
      `/api2/json/nodes/${node}/lxc/${vmid}`
    );
    await this.waitForTask(upid);

    // Clean up metadata
    this.instanceMetadata.delete(vmid);
    this.instanceServices.delete(vmid);
  }

  /**
   * Get container status
   */
  private async getContainerStatus(
    vmid: number
  ): Promise<ContainerStatus> {
    try {
      const node = await this.getNode();
      const status = await this.apiRequest<PveContainerStatus>(
        "GET",
        `/api2/json/nodes/${node}/lxc/${vmid}/status/current`
      );

      switch (status.status) {
        case "running":
          return "running";
        case "stopped":
          return "stopped";
        case "paused":
          return "paused";
        default:
          return "unknown";
      }
    } catch {
      return "unknown";
    }
  }

  /**
   * Instances namespace (mirrors MorphCloudClient.instances)
   */
  instances = {
    /**
     * Start a new container from a template using linked-clone (fast, copy-on-write).
     */
    start: async (options: StartContainerOptions): Promise<PveLxcInstance> => {
      const { templateVmid } = this.parseSnapshotId(options.snapshotId);
      const newVmid = await this.findNextVmid();
      const hostname = `cmux-${newVmid}`;

      console.log(
        `[PveLxcClient] Linked-cloning from template ${templateVmid} to ${newVmid}`
      );

      // Linked-clone from template (fast, copy-on-write)
      await this.linkedCloneFromTemplate(templateVmid, newVmid, hostname);

      // Start the container
      await this.startContainer(newVmid);

      // Wait for container to be fully running
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Get container IP
      const ipAddress = await this.getContainerIp(newVmid);

      // Store metadata
      const metadata = options.metadata || {};
      this.instanceMetadata.set(newVmid, metadata);

      // Initialize services with standard cmux ports
      const services: HttpService[] = [];
      if (ipAddress) {
        services.push(
          { name: "vscode", port: 39378, url: `http://${ipAddress}:39378` },
          { name: "worker", port: 39377, url: `http://${ipAddress}:39377` }
        );
      }
      this.instanceServices.set(newVmid, services);

      const node = await this.getNode();
      const instance = new PveLxcInstance(
        this,
        newVmid,
        "running",
        metadata,
        { httpServices: services, ipAddress },
        node,
        this.sshHost
      );

      console.log(
        `[PveLxcClient] Container ${newVmid} started with IP ${ipAddress || "pending"}`
      );

      return instance;
    },

    /**
     * Get an existing container instance
     */
    get: async (options: { instanceId: string }): Promise<PveLxcInstance> => {
      // Parse instance ID (format: pve_lxc_{vmid})
      const match = options.instanceId.match(/^pve_lxc_(\d+)$/);
      if (!match) {
        throw new Error(`Invalid PVE LXC instance ID: ${options.instanceId}`);
      }
      const vmid = parseInt(match[1], 10);

      const node = await this.getNode();
      const status = await this.getContainerStatus(vmid);
      const ipAddress = await this.getContainerIp(vmid);
      const metadata = this.instanceMetadata.get(vmid) || {};
      const services = this.instanceServices.get(vmid) || [];

      return new PveLxcInstance(
        this,
        vmid,
        status,
        metadata,
        { httpServices: services, ipAddress },
        node,
        this.sshHost
      );
    },

    /**
     * List all cmux containers
     */
    list: async (): Promise<PveLxcInstance[]> => {
      const node = await this.getNode();
      const containers = await this.apiRequest<PveContainerStatus[]>(
        "GET",
        `/api2/json/nodes/${node}/lxc`
      );

      const instances: PveLxcInstance[] = [];
      for (const container of containers) {
        const metadata = this.instanceMetadata.get(container.vmid);
        // Only include containers we know about (have metadata)
        if (metadata?.app?.startsWith("cmux")) {
          const status = await this.getContainerStatus(container.vmid);
          const ipAddress = await this.getContainerIp(container.vmid);
          const services = this.instanceServices.get(container.vmid) || [];

          instances.push(
            new PveLxcInstance(
              this,
              container.vmid,
              status,
              metadata,
              { httpServices: services, ipAddress },
              node,
              this.sshHost
            )
          );
        }
      }

      return instances;
    },
  };
}

/**
 * Create a PVE LXC client instance
 */
export function getPveLxcClient(): PveLxcClient {
  if (!env.PVE_API_URL || !env.PVE_API_TOKEN) {
    throw new Error("PVE API URL and token not configured");
  }

  return new PveLxcClient({
    apiUrl: env.PVE_API_URL,
    apiToken: env.PVE_API_TOKEN,
    node: env.PVE_NODE,
  });
}
