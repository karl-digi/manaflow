/**
 * Unified sandbox preset types for all providers.
 *
 * This module provides a common interface for sandbox presets that can be
 * used across different providers (Morph, PVE LXC, PVE VM, etc.).
 *
 * When adding a new provider:
 * 1. Add the provider type to SandboxProviderType
 * 2. Add capabilities to SandboxProviderCapabilities
 * 3. Create a mapping function in the provider's module
 */

/**
 * Supported sandbox provider types.
 * Add new providers here as they are implemented.
 *
 * Naming convention: Use hyphenated format for multi-word providers
 * - morph: Morph Cloud
 * - pve-lxc: Proxmox VE LXC containers
 * - pve-vm: Proxmox VE QEMU virtual machines
 */
export type SandboxProviderType = "morph" | "pve-lxc" | "pve-vm";

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
  morph: ["4vcpu_16gb_48gb", "8vcpu_32gb_48gb"],
  "pve-lxc": ["4vcpu_6gb_32gb", "6vcpu_8gb_32gb"],
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
 * Parse a unified snapshot ID to extract provider and metadata.
 *
 * Supported formats:
 * - morph_{presetId}_v{version}  (e.g., "morph_4vcpu_16gb_48gb_v1")
 * - pvelxc_{presetId}_v{version} (e.g., "pvelxc_4vcpu_6gb_32gb_v1")
 * - pvevm_{presetId}_v{version}  (e.g., "pvevm_4vcpu_6gb_32gb_v1")
 * - pve_{presetId}_{vmid}        (backwards compat, old format)
 *
 * @param id - The unified snapshot ID to parse
 * @returns Parsed components or null if format is invalid
 */
export function parseSnapshotId(id: string): {
  provider: SandboxProviderType;
  presetId: string;
  version: number;
} | null {
  // Match unified format: prefix_cpu_mem_disk_v123
  const match = id.match(/^(morph|pvelxc|pvevm)_([^_]+_[^_]+_[^_]+)_v(\d+)$/);
  if (match) {
    const [, prefix, presetId, versionStr] = match;
    const providerMap: Record<string, SandboxProviderType> = {
      morph: "morph",
      pvelxc: "pve-lxc",
      pvevm: "pve-vm",
    };

    const provider = providerMap[prefix];
    if (!provider) {
      return null;
    }

    return {
      provider,
      presetId,
      version: parseInt(versionStr, 10),
    };
  }

  // Backwards compat: old pve_{presetId}_{vmid} format
  const oldPveMatch = id.match(/^pve_([^_]+_[^_]+_[^_]+)_(\d+)$/);
  if (oldPveMatch) {
    return {
      provider: "pve-lxc",
      presetId: oldPveMatch[1],
      version: 1,  // Assume v1 for old format
    };
  }

  return null;
}

/**
 * Resolved snapshot identifier with provider-specific details.
 * Different providers use different identifiers for API operations.
 */
export interface ResolvedSnapshotId {
  /** The sandbox provider type */
  provider: SandboxProviderType;
  /** Version number */
  version: number;
  /** Morph Cloud API snapshot ID (format: snapshot_...) */
  snapshotId?: string;
  /** PVE template VMID (for LXC/VM cloning) */
  templateVmid?: number;
}

/**
 * Resolve a unified snapshot ID to provider-specific API identifiers.
 *
 * This function converts our user-facing unified IDs into the actual
 * provider-specific identifiers needed for API operations:
 * - Morph: Returns the cloud snapshot ID (snapshot_...)
 * - PVE LXC/VM: Returns the template VMID number
 *
 * Note: This function requires runtime imports to avoid circular dependencies.
 * It should only be used in backend/server contexts, not in shared schema definitions.
 *
 * @param unifiedId - The unified snapshot ID (e.g., "morph_4vcpu_16gb_48gb_v1")
 * @returns Resolved provider-specific identifiers
 * @throws Error if the ID format is invalid or the snapshot is not found
 *
 * @example
 * ```typescript
 * // Morph Cloud
 * const resolved = resolveSnapshotId("morph_4vcpu_16gb_48gb_v1");
 * // Returns: { provider: "morph", version: 1, snapshotId: "snapshot_5a255f9t" }
 *
 * // PVE LXC
 * const resolved = resolveSnapshotId("pvelxc_4vcpu_6gb_32gb_v1");
 * // Returns: { provider: "pve-lxc", version: 1, templateVmid: 9011 }
 * ```
 */
export async function resolveSnapshotId(unifiedId: string): Promise<ResolvedSnapshotId> {
  const parsed = parseSnapshotId(unifiedId);
  if (!parsed) {
    throw new Error(`Invalid snapshot ID format: ${unifiedId}`);
  }

  switch (parsed.provider) {
    case "morph": {
      // Dynamic import to avoid circular dependency
      const { MORPH_SNAPSHOT_PRESETS } = await import("./morph-snapshots");
      const preset = MORPH_SNAPSHOT_PRESETS.find(p => p.presetId === parsed.presetId);
      if (!preset) {
        throw new Error(`Morph preset not found: ${parsed.presetId}`);
      }

      // Find the specific version
      const versionData = preset.versions.find(v => v.version === parsed.version);
      if (!versionData) {
        throw new Error(`Morph version not found: ${parsed.version} for preset ${parsed.presetId}`);
      }

      return {
        provider: "morph",
        version: parsed.version,
        snapshotId: versionData.snapshotId,  // Returns "snapshot_5a255f9t"
      };
    }

    case "pve-lxc": {
      // Dynamic import to avoid circular dependency
      const { PVE_LXC_SNAPSHOT_PRESETS } = await import("./pve-lxc-snapshots");
      const preset = PVE_LXC_SNAPSHOT_PRESETS.find(p => p.presetId === parsed.presetId);
      if (!preset) {
        throw new Error(`PVE LXC preset not found: ${parsed.presetId}`);
      }

      // Find the specific version
      const versionData = preset.versions.find(v => v.version === parsed.version);
      if (!versionData) {
        throw new Error(`PVE LXC version not found: ${parsed.version} for preset ${parsed.presetId}`);
      }

      return {
        provider: "pve-lxc",
        version: parsed.version,
        templateVmid: versionData.templateVmid,  // Returns VMID like 9011
      };
    }

    case "pve-vm": {
      // TODO: Implement when PVE VM is added
      throw new Error("PVE VM provider not yet implemented");
    }

    default: {
      const _exhaustive: never = parsed.provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}
