/**
 * Unified sandbox preset types for all providers.
 *
 * This module provides a common interface for sandbox presets that can be
 * used across different providers (Morph, PVE LXC, PVE VM, etc.).
 *
 * When adding a new provider:
 * 1. Add the provider type to CONFIG_PROVIDERS in provider-types.ts
 * 2. Add capabilities to SandboxProviderCapabilities
 * 3. Create a mapping function in the provider's module
 */
import type { ConfigProvider } from "./provider-types";

/**
 * Supported sandbox provider types.
 * Sourced from provider-types.ts.
 *
 * Naming convention: Use hyphenated format for multi-word providers
 * - morph: Morph Cloud
 * - pve-lxc: Proxmox VE LXC containers
 * - pve-vm: Proxmox VE QEMU virtual machines
 */
export type SandboxProviderType = ConfigProvider;

/**
 * Display names for providers (for UI)
 */
export const SANDBOX_PROVIDER_DISPLAY_NAMES: Record<SandboxProviderType, string> = {
  morph: "Morph Cloud",
  "pve-lxc": "Proxmox LXC",
  "pve-vm": "Proxmox VM",
};

/**
 * Capabilities that a sandbox provider may support.
 * Used by frontend to show/hide features based on provider capabilities.
 */
export interface SandboxProviderCapabilities {
  /** Provider supports pausing/resuming with RAM state preservation */
  supportsHibernate: boolean;
  /** Provider supports live snapshots */
  supportsSnapshots: boolean;
  /** Provider supports resizing resources after creation */
  supportsResize: boolean;
  /** Provider supports nested virtualization */
  supportsNestedVirt: boolean;
  /** Provider supports GPU passthrough */
  supportsGpu: boolean;
}

/**
 * Default capabilities by provider type
 */
export const SANDBOX_PROVIDER_CAPABILITIES: Record<SandboxProviderType, SandboxProviderCapabilities> = {
  morph: {
    supportsHibernate: true,
    supportsSnapshots: true,
    supportsResize: false,
    supportsNestedVirt: false,
    supportsGpu: false,
  },
  "pve-lxc": {
    supportsHibernate: false, // LXC doesn't support true hibernate, only stop/start
    supportsSnapshots: true,
    supportsResize: true,
    supportsNestedVirt: false,
    supportsGpu: false,
  },
  "pve-vm": {
    supportsHibernate: true, // QEMU VMs support hibernate/suspend to disk
    supportsSnapshots: true,
    supportsResize: true,
    supportsNestedVirt: true,
    supportsGpu: true,
  },
};

/**
 * A unified sandbox preset that works across all providers.
 * This is the common format returned by the API.
 */
export interface SandboxPreset {
  /** Unique identifier for this preset (provider-specific format) */
  id: string;
  /** Preset identifier in format: <cpu>_<memory>_<disk> */
  presetId: string;
  /** Human-readable label (e.g., "Standard workspace") */
  label: string;
  /** CPU description (e.g., "4 vCPU") */
  cpu: string;
  /** Memory description (e.g., "16 GB RAM") */
  memory: string;
  /** Disk description (e.g., "48 GB SSD") */
  disk: string;
  /** Optional description for this preset */
  description?: string;
}

/**
 * Configuration returned by the sandbox config API endpoint.
 */
export interface SandboxConfig {
  /** The active provider type */
  provider: SandboxProviderType;
  /** Display name for the provider */
  providerDisplayName: string;
  /** Available presets for the active provider */
  presets: SandboxPreset[];
  /** Default preset ID to use */
  defaultPresetId: string;
  /** Provider capabilities */
  capabilities: SandboxProviderCapabilities;
}

/**
 * Preset IDs that should be shown in the environment creation UI.
 * Maps provider type to visible preset IDs for that provider.
 *
 * When a provider returns presets, we filter to only show these preset IDs.
 * This allows each provider to have different resource configurations
 * while maintaining consistent "standard" and "performance" tiers in the UI.
 */
export const UI_VISIBLE_PRESET_IDS_BY_PROVIDER: Record<SandboxProviderType, readonly string[]> = {
  morph: ["4vcpu_8gb_32gb", "6vcpu_8gb_32gb", "4vcpu_16gb_48gb", "8vcpu_32gb_48gb"],
  // Keep in sync with the latest pve-lxc snapshot manifest; disk size bumped to 40GB
  "pve-lxc": ["4vcpu_8gb_32gb", "6vcpu_8gb_40gb"],
  "pve-vm": [], // TODO: Add when PVE VM presets are defined
};

/**
 * All UI visible preset IDs across all providers (for backwards compatibility)
 */
export const UI_VISIBLE_PRESET_IDS = [
  ...UI_VISIBLE_PRESET_IDS_BY_PROVIDER.morph,
  ...UI_VISIBLE_PRESET_IDS_BY_PROVIDER["pve-lxc"],
  ...UI_VISIBLE_PRESET_IDS_BY_PROVIDER["pve-vm"],
] as const;

/**
 * Filter presets to only show UI-visible ones.
 * Accepts all preset IDs from any provider for flexibility.
 */
export function filterVisiblePresets(presets: SandboxPreset[]): SandboxPreset[] {
  return presets.filter((p) =>
    (UI_VISIBLE_PRESET_IDS as readonly string[]).includes(p.presetId)
  );
}

/**
 * Resolved snapshot identifier with provider-specific details.
 * Different providers use different identifiers for API operations.
 */
export interface ResolvedSnapshotId {
  /** The sandbox provider type */
  provider: SandboxProviderType;
  /** Canonical snapshot ID (snapshot_*) */
  snapshotId: string;
  /** Version number */
  version: number;
  /** PVE template VMID (for LXC/VM cloning) */
  templateVmid?: number;
}

/**
 * Resolve a snapshot ID to provider-specific API identifiers.
 *
 * This function converts our canonical snapshot IDs into the actual
 * provider-specific identifiers needed for API operations.
 *
 * Note: snapshot IDs are provider-agnostic (snapshot_*). The caller must
 * pass the provider to resolve correctly.
 *
 * Note: This function requires runtime imports to avoid circular dependencies.
 * It should only be used in backend/server contexts, not in shared schema definitions.
 *
 * @param snapshotId - The canonical snapshot ID (snapshot_*)
 * @param provider - The snapshot provider ("morph", "pve-lxc", "pve-vm")
 * @returns Resolved provider-specific identifiers
 * @throws Error if the ID format is invalid or the snapshot is not found
 *
 * @example
 * ```typescript
 * // Morph Cloud
 * const resolved = resolveSnapshotId("snapshot_5a255f9t", "morph");
 * // Returns: { provider: "morph", version: 1, snapshotId: "snapshot_5a255f9t" }
 *
 * // PVE LXC
 * const resolved = resolveSnapshotId("snapshot_pvelxc9k1x", "pve-lxc");
 * // Returns: { provider: "pve-lxc", version: 1, snapshotId: "snapshot_pvelxc9k1x", templateVmid: 9011 }
 * ```
 */
export async function resolveSnapshotId(
  snapshotId: string,
  provider: SandboxProviderType,
): Promise<ResolvedSnapshotId> {
  switch (provider) {
    case "morph": {
      // Dynamic import to avoid circular dependency
      const { MORPH_SNAPSHOT_PRESETS } = await import("./morph-snapshots");
      const versionData = MORPH_SNAPSHOT_PRESETS.flatMap(preset => preset.versions)
        .find(version => version.snapshotId === snapshotId);
      if (versionData) {
        return {
          provider: "morph",
          version: versionData.version,
          snapshotId: versionData.snapshotId,
        };
      }
      throw new Error(`Morph snapshot not found: ${snapshotId}`);
    }

    case "pve-lxc": {
      // Dynamic import to avoid circular dependency
      const { PVE_LXC_SNAPSHOT_PRESETS } = await import("./pve-lxc-snapshots");
      const versionData = PVE_LXC_SNAPSHOT_PRESETS.flatMap(preset => preset.versions)
        .find(version => version.snapshotId === snapshotId);
      if (versionData) {
        return {
          provider: "pve-lxc",
          version: versionData.version,
          snapshotId: versionData.snapshotId,
          templateVmid: versionData.templateVmid,
        };
      }
      throw new Error(`PVE LXC snapshot not found: ${snapshotId}`);
    }

    case "pve-vm": {
      // TODO: Implement when PVE VM is added
      throw new Error("PVE VM provider not yet implemented");
    }

    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}
