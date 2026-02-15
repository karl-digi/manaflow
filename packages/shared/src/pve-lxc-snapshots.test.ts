import { describe, expect, it } from "vitest";
import {
  DEFAULT_PVE_LXC_SNAPSHOT_ID,
  getPveLxcSnapshotByPresetId,
  getPveLxcSnapshotIdByPresetId,
  getPveLxcTemplateVmidByPresetId,
  PVE_LXC_SNAPSHOT_MANIFEST,
  PVE_LXC_SNAPSHOT_PRESETS,
  pveLxcSnapshotManifestSchema,
} from "./pve-lxc-snapshots";

describe("pve lxc snapshots manifest", () => {
  it("matches the schema", () => {
    const parsed = pveLxcSnapshotManifestSchema.parse(
      PVE_LXC_SNAPSHOT_MANIFEST,
    );
    expect(parsed.presets.length).toBeGreaterThan(0);
    expect(parsed.schemaVersion).toBe(2);
  });

  it("uses resource-based preset ids with ordered versions", () => {
    for (const preset of PVE_LXC_SNAPSHOT_PRESETS) {
      // Check preset ID format: <cpu>_<memory>_<disk>
      expect(preset.presetId).toMatch(/^[a-z0-9]+_[a-z0-9]+_[a-z0-9]+$/i);

      // Check versions are ordered
      const versions = preset.versions.map((version) => version.version);
      expect(versions).toEqual([...versions].sort((a, b) => a - b));
    }
  });

  it("exposes the latest template version per preset", () => {
    for (const preset of PVE_LXC_SNAPSHOT_PRESETS) {
      const latest = preset.versions[preset.versions.length - 1];
      expect(latest).toBeDefined();
      expect(preset.latestVersion).toEqual(latest);

      // Check canonical snapshot ID format
      expect(preset.id).toBe(latest.snapshotId);
      expect(preset.id).toMatch(/^snapshot_[a-z0-9]+$/i);

      // Check template VMID is preserved
      expect(preset.templateVmid).toBe(latest.templateVmid);
      expect(preset.templateVmid).toBeGreaterThan(0);
    }
  });

  it("keeps the default snapshot id in sync with the first preset", () => {
    expect(DEFAULT_PVE_LXC_SNAPSHOT_ID).toBe(
      PVE_LXC_SNAPSHOT_PRESETS[0].id,
    );
  });

  it("has valid template VMIDs", () => {
    for (const preset of PVE_LXC_SNAPSHOT_PRESETS) {
      for (const version of preset.versions) {
        expect(version.templateVmid).toBeGreaterThan(0);
        expect(Number.isInteger(version.templateVmid)).toBe(true);
      }
    }
  });

  it("has valid captured dates", () => {
    for (const preset of PVE_LXC_SNAPSHOT_PRESETS) {
      for (const version of preset.versions) {
        const date = new Date(version.capturedAt);
        expect(date.toString()).not.toBe("Invalid Date");
        expect(date.getTime()).toBeGreaterThan(0);
      }
    }
  });

  it("has required fields for each preset", () => {
    for (const preset of PVE_LXC_SNAPSHOT_PRESETS) {
      expect(preset.presetId).toBeTruthy();
      expect(preset.label).toBeTruthy();
      expect(preset.cpu).toBeTruthy();
      expect(preset.memory).toBeTruthy();
      expect(preset.disk).toBeTruthy();
      expect(preset.versions.length).toBeGreaterThan(0);
    }
  });

  describe("getPveLxcSnapshotByPresetId", () => {
    it("returns preset for valid preset id", () => {
      const firstPreset = PVE_LXC_SNAPSHOT_PRESETS[0];
      const result = getPveLxcSnapshotByPresetId(firstPreset.presetId);
      expect(result).toEqual(firstPreset);
    });

    it("returns undefined for invalid preset id", () => {
      const result = getPveLxcSnapshotByPresetId("invalid_preset_id");
      expect(result).toBeUndefined();
    });
  });

  describe("getPveLxcSnapshotIdByPresetId", () => {
    it("returns canonical snapshot id for valid preset id", () => {
      const firstPreset = PVE_LXC_SNAPSHOT_PRESETS[0];
      const result = getPveLxcSnapshotIdByPresetId(firstPreset.presetId);
      expect(result).toBe(firstPreset.id);
      expect(result).toMatch(/^snapshot_[a-z0-9]+$/i);
    });

    it("returns undefined for invalid preset id", () => {
      const result = getPveLxcSnapshotIdByPresetId("invalid_preset_id");
      expect(result).toBeUndefined();
    });
  });

  describe("getPveLxcTemplateVmidByPresetId", () => {
    it("returns template vmid for valid preset id", () => {
      const firstPreset = PVE_LXC_SNAPSHOT_PRESETS[0];
      const result = getPveLxcTemplateVmidByPresetId(firstPreset.presetId);
      expect(result).toBe(firstPreset.templateVmid);
      expect(result).toBeGreaterThan(0);
      expect(Number.isInteger(result)).toBe(true);
    });

    it("returns undefined for invalid preset id", () => {
      const result = getPveLxcTemplateVmidByPresetId("invalid_preset_id");
      expect(result).toBeUndefined();
    });
  });
});
