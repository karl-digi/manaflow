/**
 * Sandbox snapshot ID schemas for OpenAPI type generation.
 *
 * This module creates Zod enum schemas from snapshot manifests so that
 * literal snapshot IDs appear in generated OpenAPI types. This allows
 * frontend code to have type-safe access to valid snapshot IDs.
 *
 * When a new sandbox provider is added:
 * 1. Import its snapshot presets
 * 2. Create an enum schema from the preset IDs
 * 3. Add it to the union in `SandboxSnapshotIdSchema`
 */
import { z } from "@hono/zod-openapi";
import {
  MORPH_SNAPSHOT_PRESETS,
  type MorphSnapshotId,
} from "@/lib/utils/morph-defaults";
import {
  PVE_LXC_SNAPSHOT_PRESETS,
  type PveLxcSnapshotId,
} from "@/lib/utils/pve-lxc-defaults";

// ============================================================================
// Morph Snapshot Schema
// ============================================================================

const morphSnapshotIds = MORPH_SNAPSHOT_PRESETS.map(
  (preset) => preset.id
) as MorphSnapshotId[];

/**
 * Zod enum schema for Morph snapshot IDs.
 * Generated from morph-snapshots.json at module load time.
 */
export const MorphSnapshotIdSchema = z.enum(
  morphSnapshotIds as [MorphSnapshotId, ...MorphSnapshotId[]]
);

// ============================================================================
// PVE LXC Snapshot Schema
// ============================================================================

const pveLxcSnapshotIds = PVE_LXC_SNAPSHOT_PRESETS.map(
  (preset) => preset.id
) as PveLxcSnapshotId[];

/**
 * Zod enum schema for PVE LXC template IDs.
 * Generated from pve-lxc-snapshots.json at module load time.
 */
export const PveLxcSnapshotIdSchema = z.enum(
  pveLxcSnapshotIds as [PveLxcSnapshotId, ...PveLxcSnapshotId[]]
);

// ============================================================================
// Unified Sandbox Snapshot Schema
// ============================================================================

/**
 * Union of all known snapshot ID schemas from all providers.
 *
 * This allows the API to accept snapshot IDs from any supported provider
 * while maintaining type safety. The union includes:
 * - `z.string()` for custom/team-specific snapshots (backwards compatible)
 * - `MorphSnapshotIdSchema` for known Morph snapshots
 * - `PveLxcSnapshotIdSchema` for known PVE LXC templates
 *
 * When adding a new provider, add its schema to this union.
 */
export const SandboxSnapshotIdSchema = z.union([
  z.string(),
  MorphSnapshotIdSchema,
  PveLxcSnapshotIdSchema,
]);

/**
 * Type representing any valid sandbox snapshot ID.
 * Includes both known provider snapshots and custom team snapshots.
 */
export type SandboxSnapshotId = z.infer<typeof SandboxSnapshotIdSchema>;

// ============================================================================
// Provider-specific Schema Helpers
// ============================================================================

/**
 * Get all known snapshot IDs across all providers.
 * Useful for validation and UI dropdown population.
 */
export function getAllKnownSnapshotIds(): string[] {
  return [...morphSnapshotIds, ...pveLxcSnapshotIds];
}

/**
 * Check if a snapshot ID is a known default from any provider.
 */
export function isKnownProviderSnapshot(snapshotId: string): boolean {
  return getAllKnownSnapshotIds().includes(snapshotId);
}
