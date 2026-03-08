/**
 * Canonical provider type definitions for sandbox environments.
 *
 * This module is the single source of truth for all sandbox-related
 * provider types used throughout the application.
 */

/**
 * Providers that can run workspaces at runtime.
 * - docker: Local Docker containers
 * - morph: Morph Cloud VMs
 * - e2b: E2B sandboxes
 * - daytona: Daytona workspaces
 * - pve-lxc: Proxmox VE LXC containers
 * - other: Generic/unknown provider
 */
export const RUNTIME_PROVIDERS = [
  "docker",
  "morph",
  "e2b",
  "daytona",
  "pve-lxc",
  "other",
] as const;

/** Providers that support snapshot/restore operations */
export const SNAPSHOT_PROVIDERS = [...RUNTIME_PROVIDERS, "pve-vm"] as const;

/** Providers that support devbox (development environment) operations */
export const DEVBOX_PROVIDERS = [
  "morph",
  "e2b",
  "modal",
  "daytona",
  "pve-lxc",
] as const;

/** Providers that support configuration via the sandbox config API */
export const CONFIG_PROVIDERS = ["morph", "pve-lxc", "pve-vm"] as const;

/** A provider that can execute workspace containers at runtime */
export type RuntimeProvider = (typeof RUNTIME_PROVIDERS)[number];

/** A provider that supports snapshot/restore operations */
export type SnapshotProvider = (typeof SNAPSHOT_PROVIDERS)[number];

/** A provider that supports devbox operations */
export type DevboxProvider = (typeof DEVBOX_PROVIDERS)[number];

/** A provider that supports configuration via the sandbox config API */
export type ConfigProvider = (typeof CONFIG_PROVIDERS)[number];

/**
 * Default sandbox provider used when SANDBOX_PROVIDER env is unset and
 * auto-detection finds no credentials. Change this single constant to
 * switch the project-wide fallback.
 */
export const DEFAULT_SANDBOX_PROVIDER = "pve-lxc" as const;

/**
 * Backward-compatible alias for existing call sites.
 * @deprecated Use RuntimeProvider instead
 */
export type VSCodeProvider = RuntimeProvider;
