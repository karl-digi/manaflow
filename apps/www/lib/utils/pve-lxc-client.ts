/**
 * Proxmox VE LXC Client
 *
 * A client for managing LXC containers on Proxmox VE that mirrors
 * the MorphCloudClient interface for seamless provider switching.
 * Supports unified snapshot ID format (pvelxc_{presetId}_v{version}).
 */

import { env } from "./www-env";
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
  /** Container hostname (e.g., "cmux-200") */
  hostname?: string;
  /** Fully qualified domain name (e.g., "cmux-200.lan") */
  fqdn?: string;
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

  constructor(
    client: PveLxcClient,
    vmid: number,
    status: ContainerStatus,
    metadata: ContainerMetadata,
    networking: ContainerNetworking,
    node: string
  ) {
    this.client = client;
    this.vmid = vmid;
    this.id = `pve_lxc_${vmid}`;
    this.status = status;
    this.metadata = metadata;
    this.networking = networking;
    this.node = node;
  }

  /**
   * Execute a command inside the container via HTTP exec (cmux-execd).
   */
  async exec(command: string, options?: { timeoutMs?: number }): Promise<ExecResult> {
    return this.client.execInContainer(this.vmid, command, {
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
   * Pause the container (LXC doesn't support hibernate, use stop instead)
   * Note: Unlike Morph VMs, LXC containers don't preserve RAM state on stop.
   */
  async pause(): Promise<void> {
    await this.client.stopContainer(this.vmid);
    this.status = "stopped";
  }

  /**
   * Resume the container (restart after stop)
   */
  async resume(): Promise<void> {
    await this.client.startContainer(this.vmid);
    this.status = "running";
  }

  /**
   * Expose an HTTP service (stores in metadata, actual exposure via FQDN)
   */
  async exposeHttpService(name: string, port: number): Promise<void> {
    // Use FQDN for service URLs
    const host = this.networking.fqdn;
    if (!host) {
      throw new Error("Container FQDN not available");
    }

    const url = `http://${host}:${port}`;
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
  template?: number;
}

/**
 * PVE container network interface configuration
 */
interface PveContainerConfig {
  net0?: string; // Format: name=eth0,bridge=vmbr0,ip=10.100.0.X/24,gw=10.100.0.1
  [key: string]: string | number | undefined;
}

/**
 * PVE DNS configuration response
 */
interface PveDnsConfig {
  search?: string;
  dns1?: string;
  dns2?: string;
  dns3?: string;
}

/**
 * Proxmox VE LXC Client
 */
export class PveLxcClient {
  private apiUrl: string;
  private apiToken: string;
  private node: string | null;
  /** Domain suffix for FQDNs, auto-detected from PVE DNS config (e.g., ".lan") */
  private domainSuffix: string | null = null;
  /** Whether we've attempted to fetch the domain suffix */
  private domainSuffixFetched: boolean = false;
  /** Public domain for external access via Cloudflare Tunnel (e.g., "example.com") */
  private publicDomain: string | null;

  // In-memory store for HTTP service URLs (computed from VMID, not persisted)
  // Note: Instance metadata (teamId, userId, etc.) is now tracked in Convex
  // via sandboxInstanceActivity table, not stored here.
  private instanceServices: Map<number, HttpService[]> = new Map();

  constructor(options: {
    apiUrl: string;
    apiToken: string;
    node?: string;
    publicDomain?: string;
  }) {
    this.apiUrl = options.apiUrl.replace(/\/$/, "");
    this.apiToken = options.apiToken;
    this.node = options.node || null; // Will be auto-detected if not provided
    this.publicDomain = options.publicDomain || null;
  }

  /**
   * Get the domain suffix, auto-detecting from PVE DNS config if not already fetched.
   * Returns null if no search domain is configured.
   */
  private async getDomainSuffix(): Promise<string | null> {
    if (this.domainSuffixFetched) {
      return this.domainSuffix;
    }

    try {
      const node = await this.getNode();
      const dnsConfig = await this.apiRequest<PveDnsConfig>(
        "GET",
        `/api2/json/nodes/${node}/dns`
      );

      if (dnsConfig?.search) {
        // PVE returns "lan" or "example.com", we need ".lan" or ".example.com"
        this.domainSuffix = `.${dnsConfig.search}`;
        console.log(`[PveLxcClient] Auto-detected domain suffix: ${this.domainSuffix}`);
      } else {
        console.log("[PveLxcClient] No DNS search domain configured, using IP addresses");
        this.domainSuffix = null;
      }
    } catch (error) {
      console.error("[PveLxcClient] Failed to fetch DNS config:", error);
      this.domainSuffix = null;
    }

    this.domainSuffixFetched = true;
    return this.domainSuffix;
  }

  /**
   * Get the FQDN for a hostname.
   */
  private getFqdnSync(hostname: string, domainSuffix: string | null): string | undefined {
    if (domainSuffix) {
      return `${hostname}${domainSuffix}`;
    }
    return undefined;
  }

  /**
   * Build a public URL for a service via Cloudflare Tunnel.
   * Pattern (Morph-consistent): https://port-{port}-vm-{vmid}.{publicDomain}
   * Returns null if publicDomain is not configured.
   */
  private buildPublicServiceUrl(port: number, vmid: number): string | null {
    if (!this.publicDomain) {
      return null;
    }
    return `https://port-${port}-vm-${vmid}.${this.publicDomain}`;
  }

  /**
   * Get the IP address of a container from its network configuration.
   * Parses the net0 config field (format: name=eth0,ip=10.100.0.X/24,gw=...)
   * Returns null if IP cannot be determined.
   */
  private async getContainerIp(vmid: number): Promise<string | null> {
    try {
      const node = await this.getNode();
      const config = await this.apiRequest<PveContainerConfig>(
        "GET",
        `/api2/json/nodes/${node}/lxc/${vmid}/config`
      );

      // Parse net0 configuration to extract IP
      // Format: name=eth0,bridge=vmbr0,ip=10.100.0.123/24,gw=10.100.0.1
      const net0 = config.net0;
      if (!net0) return null;

      const ipMatch = net0.match(/ip=([0-9.]+)/);
      if (ipMatch?.[1]) {
        return ipMatch[1];
      }

      return null;
    } catch (error) {
      console.error(`[PveLxcClient] Failed to get IP for container ${vmid}:`, error);
      return null;
    }
  }

  /**
   * Build a service URL using the best available method:
   * 1. Public URL via Cloudflare Tunnel (if configured)
   * 2. FQDN (if DNS search domain is configured)
   * 3. Container IP address (fallback for local dev)
   *
   * Returns null if no URL can be built.
   */
  private async buildServiceUrl(
    port: number,
    vmid: number,
    hostname: string,
    domainSuffix: string | null
  ): Promise<string | null> {
    // 1. Try public URL (Cloudflare Tunnel)
    const publicUrl = this.buildPublicServiceUrl(port, vmid);
    if (publicUrl) {
      return publicUrl;
    }

    // 2. Try FQDN
    if (domainSuffix) {
      return `http://${hostname}${domainSuffix}:${port}`;
    }

    // 3. Fallback to container IP
    const ip = await this.getContainerIp(vmid);
    if (ip) {
      console.log(`[PveLxcClient] Using IP fallback for container ${vmid}: ${ip}`);
      return `http://${ip}:${port}`;
    }

    return null;
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
   * Execute a command inside an LXC container via HTTP exec daemon.
   * This uses the cmux-execd service running in the container on port 39375.
   * Supports both internal (hostname/IP) and public (Cloudflare Tunnel) URLs.
   * Returns null if HTTP exec is not available.
   */
  private async httpExec(
    host: string,
    command: string,
    timeoutMs?: number
  ): Promise<ExecResult | null> {
    // Support both public URLs (https://exec-xxx.domain.com) and internal (hostname:port)
    const execUrl = host.startsWith("https://")
      ? `${host}/exec`
      : `http://${host}:39375/exec`;
    // Set HOME explicitly since cmux-execd may not have it set,
    // and many tools (gh, git) require HOME to be defined.
    // The command is passed directly to the execd service which runs it via sh -c.
    const body = JSON.stringify({
      command: `HOME=/root ${command}`,
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
      console.error(
        `[PveLxcClient] HTTP exec failed for ${host}:`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Execute a command inside an LXC container via HTTP exec (cmux-execd).
   * Requires cmux-execd to be running in the container on port 39375.
   * Uses public exec URL (Cloudflare Tunnel), FQDN, or hostname to reach the container.
   * Includes retry logic for container startup timing.
   */
  async execInContainer(
    vmid: number,
    command: string,
    options?: { execHost?: string; timeoutMs?: number; retries?: number }
  ): Promise<ExecResult> {
    // Determine the host to use for HTTP exec
    // Priority: provided execHost > public exec URL > hostname-based FQDN
    let host = options?.execHost;

    if (!host) {
      // Try public exec URL via Cloudflare Tunnel
      const publicExecUrl = this.buildPublicServiceUrl(39375, vmid);
      if (publicExecUrl) {
        host = publicExecUrl;
      } else {
        // Fall back to hostname + domain suffix
        const hostname = `cmux-${vmid}`;
        const domainSuffix = await this.getDomainSuffix();
        if (domainSuffix) {
          host = `${hostname}${domainSuffix}`;
        } else {
          throw new Error(
            `Cannot execute command in container ${vmid}: no public domain or DNS search domain configured`
          );
        }
      }
    }

    // Retry logic for container startup timing
    // cmux-execd may not be ready immediately after container start
    const maxRetries = options?.retries ?? 5;
    const baseDelayMs = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const httpResult = await this.httpExec(host, command, options?.timeoutMs);

      if (httpResult) {
        if (attempt > 1) {
          console.log(
            `[PveLxcClient] HTTP exec succeeded on attempt ${attempt} for ${host}`
          );
        }
        return httpResult;
      }

      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * attempt;
        console.log(
          `[PveLxcClient] HTTP exec attempt ${attempt}/${maxRetries} failed for ${host}, retrying in ${delayMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error(
      `HTTP exec failed for container ${vmid} via ${host} after ${maxRetries} attempts. ` +
        `Ensure cmux-execd is running in the container.`
    );
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
   * Parse snapshot/template ID to extract template VMID.
   * Unified format: pvelxc_{presetId}_v{version} (e.g., "pvelxc_4vcpu_6gb_32gb_v1")
   */
  private async parseSnapshotId(snapshotId: string): Promise<{
    templateVmid: number;
  }> {
    const match = snapshotId.match(/^pvelxc_([^_]+_[^_]+_[^_]+)_v(\d+)$/);
    if (!match) {
      throw new Error(
        `Invalid PVE template ID format: ${snapshotId}. ` +
        `Expected format: pvelxc_{presetId}_v{version}`
      );
    }

    const [, presetId, versionStr] = match;
    const version = parseInt(versionStr, 10);

    // Dynamic import to avoid circular dependency
    const { PVE_LXC_SNAPSHOT_PRESETS } = await import("./pve-lxc-defaults");
    const preset = PVE_LXC_SNAPSHOT_PRESETS.find(p => p.presetId === presetId);
    if (!preset) {
      throw new Error(`PVE LXC preset not found: ${presetId}`);
    }

    const versionData = preset.versions.find(v => v.version === version);
    if (!versionData) {
      throw new Error(`PVE LXC version not found: ${version} for preset ${presetId}`);
    }

    return {
      templateVmid: versionData.templateVmid,
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
   * Suspend (freeze) a container using CRIU.
   *
   * **EXPERIMENTAL - NOT FOR PRODUCTION USE**
   *
   * This method uses PVE's `pct suspend` which is marked as experimental
   * in the official Proxmox documentation. Limitations include:
   *
   * - Requires CRIU package installed on PVE host
   * - Requires kernel support for CRIU
   * - FUSE mounts inside containers are incompatible
   * - Linux kernel freezer subsystem can cause I/O deadlocks
   * - Not all processes/applications checkpoint cleanly
   *
   * For production use, prefer `stopContainer()` instead.
   *
   * @see https://pve.proxmox.com/wiki/Linux_Container
   * @internal This is a PVE-specific experimental feature
   */
  private async suspendContainer(vmid: number): Promise<void> {
    const node = await this.getNode();
    const upid = await this.apiRequest<string>(
      "POST",
      `/api2/json/nodes/${node}/lxc/${vmid}/status/suspend`
    );
    await this.waitForTask(upid);
  }

  /**
   * Resume a suspended container using CRIU.
   *
   * **EXPERIMENTAL - NOT FOR PRODUCTION USE**
   *
   * This method uses PVE's `pct resume` which is marked as experimental
   * in the official Proxmox documentation. See `suspendContainer()` for
   * full list of limitations.
   *
   * For production use, prefer `startContainer()` instead.
   *
   * @see https://pve.proxmox.com/wiki/Linux_Container
   * @internal This is a PVE-specific experimental feature
   */
  private async resumeContainer(vmid: number): Promise<void> {
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

    // Clean up in-memory service URLs
    // Note: Convex sandboxInstanceActivity is updated separately via recordStopInternal
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
     * Includes rollback logic: if clone succeeds but start fails, the container is deleted.
     */
    start: async (options: StartContainerOptions): Promise<PveLxcInstance> => {
      const { templateVmid } = await this.parseSnapshotId(options.snapshotId);
      const newVmid = await this.findNextVmid();
      const hostname = `cmux-${newVmid}`;

      // Auto-detect domain suffix from PVE DNS config
      const domainSuffix = await this.getDomainSuffix();
      const fqdn = this.getFqdnSync(hostname, domainSuffix);

      console.log(
        `[PveLxcClient] Linked-cloning from template ${templateVmid} to ${newVmid}`
      );

      // Linked-clone from template (fast, copy-on-write)
      await this.linkedCloneFromTemplate(templateVmid, newVmid, hostname);

      // Start the container with rollback on failure
      try {
        await this.startContainer(newVmid);
      } catch (startError) {
        // Clone succeeded but start failed - rollback by deleting the container
        console.error(
          `[PveLxcClient] Failed to start container ${newVmid}, rolling back clone:`,
          startError instanceof Error ? startError.message : startError
        );
        try {
          await this.deleteContainer(newVmid);
          console.log(`[PveLxcClient] Rollback complete: container ${newVmid} deleted`);
        } catch (deleteError) {
          console.error(
            `[PveLxcClient] Failed to rollback (delete) container ${newVmid}:`,
            deleteError instanceof Error ? deleteError.message : deleteError
          );
        }
        throw startError;
      }

      // Wait for container to be fully running
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Note: Metadata (teamId, userId, etc.) is tracked in Convex sandboxInstanceActivity
      // table via sandboxes.route.ts calling recordCreate mutation
      const metadata = options.metadata || {};

      // Initialize services with standard cmux ports
      // URL resolution order: public URL (Cloudflare Tunnel) > FQDN > container IP
      const services: HttpService[] = [];
      const vscodeUrl = await this.buildServiceUrl(39378, newVmid, hostname, domainSuffix);
      const workerUrl = await this.buildServiceUrl(39377, newVmid, hostname, domainSuffix);
      const vncUrl = await this.buildServiceUrl(39380, newVmid, hostname, domainSuffix);
      const xtermUrl = await this.buildServiceUrl(39383, newVmid, hostname, domainSuffix);

      if (vscodeUrl && workerUrl && vncUrl && xtermUrl) {
        services.push(
          { name: "vscode", port: 39378, url: vscodeUrl },
          { name: "worker", port: 39377, url: workerUrl },
          { name: "vnc", port: 39380, url: vncUrl },
          { name: "xterm", port: 39383, url: xtermUrl }
        );
      } else {
        throw new Error(
          `Cannot build service URLs for container ${newVmid}: no public domain, DNS search domain, or container IP available`
        );
      }
      this.instanceServices.set(newVmid, services);

      const node = await this.getNode();
      const instance = new PveLxcInstance(
        this,
        newVmid,
        "running",
        metadata,
        { httpServices: services, hostname, fqdn },
        node
      );

      console.log(
        `[PveLxcClient] Container ${newVmid} started (hostname=${hostname}, fqdn=${fqdn || "none"})`
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
      const hostname = `cmux-${vmid}`;

      // Auto-detect domain suffix from PVE DNS config
      const domainSuffix = await this.getDomainSuffix();
      const fqdn = this.getFqdnSync(hostname, domainSuffix);

      const node = await this.getNode();
      const status = await this.getContainerStatus(vmid);
      // Note: Metadata is stored in Convex sandboxInstanceActivity, not in-memory
      // Return empty metadata here; callers can query Convex for full details
      const metadata: ContainerMetadata = {};
      const services = this.instanceServices.get(vmid) || [];

      return new PveLxcInstance(
        this,
        vmid,
        status,
        metadata,
        { httpServices: services, hostname, fqdn },
        node
      );
    },

    /**
     * List all cmux containers.
     * Filters by hostname prefix "cmux-" to identify cmux-managed containers.
     * Note: Detailed metadata is stored in Convex sandboxInstanceActivity table.
     */
    list: async (): Promise<PveLxcInstance[]> => {
      const node = await this.getNode();
      const containers = await this.apiRequest<PveContainerStatus[]>(
        "GET",
        `/api2/json/nodes/${node}/lxc`
      );

      // Auto-detect domain suffix from PVE DNS config
      const domainSuffix = await this.getDomainSuffix();

      const instances: PveLxcInstance[] = [];
      for (const container of containers) {
        // Filter by hostname prefix to identify cmux-managed containers
        // This is more reliable than checking in-memory metadata
        const containerHostname = container.name || "";
        if (containerHostname.startsWith("cmux-")) {
          const hostname = containerHostname;
          const fqdn = this.getFqdnSync(hostname, domainSuffix);
          const status = await this.getContainerStatus(container.vmid);
          const services = this.instanceServices.get(container.vmid) || [];
          // Metadata is in Convex, return empty here
          const metadata: ContainerMetadata = {};

          instances.push(
            new PveLxcInstance(
              this,
              container.vmid,
              status,
              metadata,
              { httpServices: services, hostname, fqdn },
              node
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
    publicDomain: env.PVE_PUBLIC_DOMAIN,
  });
}
