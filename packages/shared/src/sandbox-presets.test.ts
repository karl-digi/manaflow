import { describe, expect, it } from "vitest";
import { parseSnapshotId } from "./sandbox-presets";

describe("parseSnapshotId", () => {
  describe("legacy format parsing", () => {
    it("parses morph snapshot ID correctly", () => {
      const result = parseSnapshotId("morph_4vcpu_6gb_32gb_v1");
      expect(result).toEqual({
        provider: "morph",
        presetId: "4vcpu_6gb_32gb",
        version: 1,
      });
    });

    it("parses pvelxc snapshot ID correctly", () => {
      const result = parseSnapshotId("pvelxc_4vcpu_6gb_32gb_v1");
      expect(result).toEqual({
        provider: "pve-lxc",
        presetId: "4vcpu_6gb_32gb",
        version: 1,
      });
    });

    it("parses pvevm snapshot ID correctly", () => {
      const result = parseSnapshotId("pvevm_4vcpu_6gb_32gb_v1");
      expect(result).toEqual({
        provider: "pve-vm",
        presetId: "4vcpu_6gb_32gb",
        version: 1,
      });
    });

    it("parses higher version numbers", () => {
      const result = parseSnapshotId("morph_4vcpu_16gb_48gb_v5");
      expect(result).toEqual({
        provider: "morph",
        presetId: "4vcpu_16gb_48gb",
        version: 5,
      });
    });

    it("parses boosted preset with different resources", () => {
      const result = parseSnapshotId("pvelxc_6vcpu_8gb_32gb_v2");
      expect(result).toEqual({
        provider: "pve-lxc",
        presetId: "6vcpu_8gb_32gb",
        version: 2,
      });
    });
  });

  describe("backwards compatibility - old PVE format", () => {
    it("parses old pve_{presetId}_{vmid} format", () => {
      const result = parseSnapshotId("pve_4vcpu_6gb_32gb_9011");
      expect(result).toEqual({
        provider: "pve-lxc",
        presetId: "4vcpu_6gb_32gb",
        version: 1, // Old format assumes v1
        templateVmid: 9011,
      });
    });

    it("parses old format with different VMID", () => {
      const result = parseSnapshotId("pve_6vcpu_8gb_32gb_9012");
      expect(result).toEqual({
        provider: "pve-lxc",
        presetId: "6vcpu_8gb_32gb",
        version: 1,
        templateVmid: 9012,
      });
    });
  });

  describe("invalid formats", () => {
    it("returns null for empty string", () => {
      expect(parseSnapshotId("")).toBeNull();
    });

    it("returns null for undefined-like input", () => {
      // TypeScript would prevent actual undefined, but test edge cases
      expect(parseSnapshotId("undefined")).toBeNull();
      expect(parseSnapshotId("null")).toBeNull();
    });

    it("returns null for random string", () => {
      expect(parseSnapshotId("random_string")).toBeNull();
    });

    it("returns null for canonical snapshot ids", () => {
      expect(parseSnapshotId("snapshot_lormn2pz")).toBeNull();
    });

    it("returns null for missing version suffix", () => {
      expect(parseSnapshotId("morph_4vcpu_6gb_32gb")).toBeNull();
    });

    it("returns null for invalid provider prefix", () => {
      expect(parseSnapshotId("docker_4vcpu_6gb_32gb_v1")).toBeNull();
      expect(parseSnapshotId("aws_4vcpu_6gb_32gb_v1")).toBeNull();
    });

    it("returns null for malformed preset ID", () => {
      // Too few underscores in presetId
      expect(parseSnapshotId("morph_4vcpu_6gb_v1")).toBeNull();
      // Too many underscores in presetId
      expect(parseSnapshotId("morph_4vcpu_6gb_32gb_extra_v1")).toBeNull();
    });

    it("returns null for non-numeric version", () => {
      expect(parseSnapshotId("morph_4vcpu_6gb_32gb_vone")).toBeNull();
      expect(parseSnapshotId("morph_4vcpu_6gb_32gb_v")).toBeNull();
    });

    it("returns null for invalid old format", () => {
      // Missing VMID
      expect(parseSnapshotId("pve_4vcpu_6gb_32gb")).toBeNull();
      // Wrong prefix
      expect(parseSnapshotId("old_4vcpu_6gb_32gb_9011")).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("handles presetId with numbers", () => {
      const result = parseSnapshotId("morph_8vcpu_16gb_64gb_v1");
      expect(result).toEqual({
        provider: "morph",
        presetId: "8vcpu_16gb_64gb",
        version: 1,
      });
    });

    it("handles large version numbers", () => {
      const result = parseSnapshotId("pvelxc_4vcpu_6gb_32gb_v999");
      expect(result).toEqual({
        provider: "pve-lxc",
        presetId: "4vcpu_6gb_32gb",
        version: 999,
      });
    });

    it("handles version 0", () => {
      // v0 might be used for dev/testing
      const result = parseSnapshotId("morph_4vcpu_6gb_32gb_v0");
      expect(result).toEqual({
        provider: "morph",
        presetId: "4vcpu_6gb_32gb",
        version: 0,
      });
    });

    it("is case-sensitive for provider prefix", () => {
      // Uppercase should fail since regex uses lowercase
      expect(parseSnapshotId("MORPH_4vcpu_6gb_32gb_v1")).toBeNull();
      expect(parseSnapshotId("Morph_4vcpu_6gb_32gb_v1")).toBeNull();
    });

    it("handles old format with large VMID", () => {
      const result = parseSnapshotId("pve_4vcpu_6gb_32gb_99999");
      expect(result).toEqual({
        provider: "pve-lxc",
        presetId: "4vcpu_6gb_32gb",
        version: 1,
        templateVmid: 99999,
      });
    });
  });
});
