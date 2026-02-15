/**
 * Unified Sandbox Instance Interface
 *
 * This module provides a common interface for sandbox instances
 * that works with both Morph and PVE LXC providers.
 */

import type { Instance } from "morphcloud";
import type { PveLxcInstance } from "./pve-lxc-client";

/**
 * Result of command execution
 */
export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

/**
 * Options for executing commands inside a sandbox
 */
export interface ExecOptions {
  /** Maximum runtime for the command in milliseconds */
  timeoutMs?: number;
}

/**
 * HTTP service exposed by the sandbox
 */
export interface HttpService {
  name: string;
  port: number;
  url: string;
}

/**
 * Sandbox networking configuration
 */
export interface SandboxNetworking {
  httpServices: HttpService[];
}

/**
 * Unified sandbox instance interface
 */
export interface SandboxInstance {
  /** Unique instance identifier */
  id: string;

  /** Current status */
  status: string;

  /** Instance metadata */
  metadata: Record<string, string | undefined>;

  /** Networking configuration */
  networking: SandboxNetworking;

  /** Execute a command inside the sandbox */
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;

  /** Stop the sandbox */
  stop(): Promise<void>;

  /** Pause the sandbox */
  pause(): Promise<void>;

  /** Resume the sandbox */
  resume(): Promise<void>;

  /** Expose an HTTP service */
  exposeHttpService(name: string, port: number): Promise<void>;

  /** Hide an HTTP service */
  hideHttpService(name: string): Promise<void>;

  /** Set wake-on behavior (Morph-specific, no-op for PVE) */
  setWakeOn(http: boolean, ssh: boolean): Promise<void>;
}

/**
 * Wrap a Morph instance to conform to SandboxInstance interface
 */
export function wrapMorphInstance(instance: Instance): SandboxInstance {
  return {
    id: instance.id,
    status: instance.status,
    metadata: instance.metadata as Record<string, string | undefined>,
    networking: {
      httpServices: instance.networking.httpServices.map((s) => ({
        name: s.name,
        port: s.port,
        url: s.url,
      })),
    },
    exec: async (command: string, options?: ExecOptions) => {
      const timeoutSeconds = options?.timeoutMs
        ? Math.ceil(options.timeoutMs / 1000)
        : undefined;

      const result = await instance.exec(command, timeoutSeconds ? { timeout: timeoutSeconds } : undefined);
      return {
        exit_code: result.exit_code,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
      };
    },
    stop: () => instance.stop(),
    pause: () => instance.pause(),
    resume: () => instance.resume(),
    exposeHttpService: async (name: string, port: number) => {
      await instance.exposeHttpService(name, port);
    },
    hideHttpService: async (name: string) => {
      await instance.hideHttpService(name);
    },
    setWakeOn: (http: boolean, ssh: boolean) => instance.setWakeOn(http, ssh),
  };
}

/**
 * Wrap a PVE LXC instance to conform to SandboxInstance interface
 */
export function wrapPveLxcInstance(instance: PveLxcInstance): SandboxInstance {
  return {
    id: instance.id,
    status: instance.status,
    metadata: instance.metadata as Record<string, string | undefined>,
    networking: {
      httpServices: instance.networking.httpServices,
    },
    exec: (command: string, options?: ExecOptions) => instance.exec(command, options),
    stop: () => instance.stop(),
    pause: () => instance.pause(),
    resume: () => instance.resume(),
    exposeHttpService: (name: string, port: number) =>
      instance.exposeHttpService(name, port),
    hideHttpService: (name: string) => instance.hideHttpService(name),
    setWakeOn: (_http: boolean, _ssh: boolean) => instance.setWakeOn(_http, _ssh),
  };
}

/**
 * Result of starting a sandbox
 */
export interface StartSandboxResult {
  instance: SandboxInstance;
  provider: string;
  vscodeService: HttpService | undefined;
  workerService: HttpService | undefined;
}
