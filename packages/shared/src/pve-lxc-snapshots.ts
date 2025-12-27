import { z } from "zod";
import pveLxcSnapshotDataJson from "./pve-lxc-snapshots.json" with {
  type: "json",
};

const isoDateStringSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO date string",
  });

const presetIdSchema = z
  .string()
  .regex(/^[a-z0-9]+_[a-z0-9]+_[a-z0-9]+$/i, {
    message: "presetId must follow <cpu>_<memory>_<disk> format",
  });

/**
 * Schema v2: Template-based versions for linked-clone support.
 * Each version has a templateVmid (the VMID of the template container).
 */
export const pveLxcTemplateVersionSchema = z.object({
  version: z.number().int().positive(),
  templateVmid: z.number().int().positive(),
  capturedAt: isoDateStringSchema,
});

export const pveLxcTemplatePresetSchema = z
  .object({
    presetId: presetIdSchema,
    label: z.string(),
    cpu: z.string(),
    memory: z.string(),
    disk: z.string(),
    description: z.string().optional(),
    versions: z.array(pveLxcTemplateVersionSchema).min(1).readonly(),
  })
  .superRefine((preset, ctx) => {
    const sortedByVersion = [...preset.versions].sort(
      (a, b) => a.version - b.version,
    );
    for (let index = 1; index < sortedByVersion.length; index += 1) {
      const previous = sortedByVersion[index - 1];
      const current = sortedByVersion[index];
      if (!previous || !current) {
        continue;
      }
      if (current.version <= previous.version) {
        ctx.addIssue({
          code: "custom",
          message: "Versions must be strictly increasing",
          path: ["versions", index, "version"],
        });
        break;
      }
    }
  });

/**
 * Schema v2 manifest: Uses templates instead of snapshots for fast linked-clone.
 * - baseTemplateVmid: The base template used to create preset templates
 * - Each preset version has templateVmid (the template container VMID)
 */
export const pveLxcTemplateManifestSchema = z.object({
  schemaVersion: z.literal(2),
  updatedAt: isoDateStringSchema,
  baseTemplateVmid: z.number().int().positive(),
  node: z.string(),
  presets: z.array(pveLxcTemplatePresetSchema).min(1),
});

// Legacy schema v1 aliases for backwards compatibility
export const pveLxcSnapshotVersionSchema = pveLxcTemplateVersionSchema;
export const pveLxcSnapshotPresetSchema = pveLxcTemplatePresetSchema;
export const pveLxcSnapshotManifestSchema = pveLxcTemplateManifestSchema;

// New schema v2 types
export type PveLxcTemplateVersion = z.infer<typeof pveLxcTemplateVersionSchema>;
export type PveLxcTemplatePreset = z.infer<typeof pveLxcTemplatePresetSchema>;
export type PveLxcTemplateManifest = z.infer<typeof pveLxcTemplateManifestSchema>;

// Legacy type aliases for backwards compatibility
export type PveLxcSnapshotVersion = PveLxcTemplateVersion;
export type PveLxcSnapshotPreset = PveLxcTemplatePreset;
export type PveLxcSnapshotManifest = PveLxcTemplateManifest;

export interface PveLxcSnapshotPresetWithLatest extends PveLxcTemplatePreset {
  /** Unique identifier for template-based cloning: pve_template_{templateVmid} */
  id: string;
  latestVersion: PveLxcTemplateVersion;
  versions: readonly PveLxcTemplateVersion[];
}

const sortVersions = (
  versions: readonly PveLxcTemplateVersion[],
): PveLxcTemplateVersion[] => [...versions].sort((a, b) => a.version - b.version);

const toPresetWithLatest = (
  preset: PveLxcTemplatePreset,
): PveLxcSnapshotPresetWithLatest => {
  const sortedVersions = sortVersions(preset.versions);
  const latestVersion = sortedVersions.length > 0 ? sortedVersions[sortedVersions.length - 1] : undefined;
  if (!latestVersion) {
    throw new Error(`Preset "${preset.presetId}" does not contain versions`);
  }
  // Create a unique ID from template VMID (schema v2 format)
  const id = `pve_template_${latestVersion.templateVmid}`;
  return {
    ...preset,
    versions: sortedVersions,
    id,
    latestVersion,
  };
};

const pveLxcSnapshotManifest =
  pveLxcSnapshotManifestSchema.parse(pveLxcSnapshotDataJson);

export const PVE_LXC_SNAPSHOT_MANIFEST: PveLxcSnapshotManifest =
  pveLxcSnapshotManifest;

const pveLxcSnapshotPresets =
  PVE_LXC_SNAPSHOT_MANIFEST.presets.map(toPresetWithLatest);

export const PVE_LXC_SNAPSHOT_PRESETS: readonly PveLxcSnapshotPresetWithLatest[] =
  pveLxcSnapshotPresets;

if (PVE_LXC_SNAPSHOT_PRESETS.length === 0) {
  throw new Error("PVE LXC snapshot manifest must include at least one preset");
}

export type PveLxcSnapshotId =
  (typeof PVE_LXC_SNAPSHOT_PRESETS)[number]["id"];

const firstPreset = PVE_LXC_SNAPSHOT_PRESETS[0];

if (!firstPreset) {
  throw new Error("PVE LXC snapshot manifest must include a default preset");
}

export const DEFAULT_PVE_LXC_SNAPSHOT_ID: PveLxcSnapshotId = firstPreset.id;

/**
 * Get the latest snapshot for a given preset ID.
 */
export const getPveLxcSnapshotByPresetId = (
  presetId: string,
): PveLxcSnapshotPresetWithLatest | undefined => {
  return PVE_LXC_SNAPSHOT_PRESETS.find((p) => p.presetId === presetId);
};

/**
 * Get the latest snapshot ID for a given preset ID.
 */
export const getPveLxcSnapshotIdByPresetId = (
  presetId: string,
): PveLxcSnapshotId | undefined => {
  const preset = getPveLxcSnapshotByPresetId(presetId);
  return preset?.id;
};
