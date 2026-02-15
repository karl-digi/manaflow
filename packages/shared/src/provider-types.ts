// Canonical tuples - single source of truth for sandbox-related providers.
export const RUNTIME_PROVIDERS = [
  "docker",
  "morph",
  "e2b",
  "daytona",
  "pve-lxc",
  "other",
] as const;

export const SNAPSHOT_PROVIDERS = [...RUNTIME_PROVIDERS, "pve-vm"] as const;

export const DEVBOX_PROVIDERS = [
  "morph",
  "e2b",
  "modal",
  "daytona",
  "pve-lxc",
] as const;

export const CONFIG_PROVIDERS = ["morph", "pve-lxc", "pve-vm"] as const;

export type RuntimeProvider = (typeof RUNTIME_PROVIDERS)[number];
export type SnapshotProvider = (typeof SNAPSHOT_PROVIDERS)[number];
export type DevboxProvider = (typeof DEVBOX_PROVIDERS)[number];
export type ConfigProvider = (typeof CONFIG_PROVIDERS)[number];

// Default sandbox provider used when SANDBOX_PROVIDER env is unset and
// auto-detection finds no credentials.  Change this single constant to
// switch the project-wide fallback.
export const DEFAULT_SANDBOX_PROVIDER = "pve-lxc" as const;

// Backward-compatible alias for existing call sites.
export type VSCodeProvider = RuntimeProvider;
