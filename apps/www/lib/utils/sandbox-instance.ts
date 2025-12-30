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
  exec(command: string): Promise<ExecResult>;

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
    exec: async (command: string) => {
      const result = await instance.exec(command);
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
    exec: (command: string) => instance.exec(command),
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
 * Provider type
 */
export type SandboxProvider = "morph" | "pve-lxc" | "pve-vm";

/**
 * Result of starting a sandbox
 */
export interface StartSandboxResult {
  instance: SandboxInstance;
  provider: SandboxProvider;
  vscodeService: HttpService | undefined;
  workerService: HttpService | undefined;
}
