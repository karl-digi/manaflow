import { describe, expect, it } from "vitest";
import {
  RESERVED_EXPOSED_PORTS,
  validateExposedPorts,
} from "./validate-exposed-ports";

describe("validateExposedPorts", () => {
  it("deduplicates and sorts valid ports", () => {
    const { sanitized } = validateExposedPorts([8080, 3000, 8080, 5000]);
    expect(sanitized).toEqual([3000, 5000, 8080]);
  });

  it("flags reserved ports", () => {
    const reserved = RESERVED_EXPOSED_PORTS[0];
    const { sanitized, reserved: blocked } = validateExposedPorts([
      3000,
      reserved,
    ]);
    expect(sanitized).toEqual([3000]);
    expect(blocked).toEqual([reserved]);
  });

  it("tracks invalid ports", () => {
    const { sanitized, invalid } = validateExposedPorts([0, -5, 8080]);
    expect(sanitized).toEqual([8080]);
    expect(invalid).toEqual([-5, 0]);
  });

  it("normalizes decimal values", () => {
    const { sanitized, invalid } = validateExposedPorts([3000.7, 3000.2]);
    expect(sanitized).toEqual([3000]);
    expect(invalid).toEqual([]);
  });

  it("ignores non-finite values", () => {
    const { sanitized, invalid, reserved } = validateExposedPorts([
      Number.NaN,
      Number.POSITIVE_INFINITY,
      4000,
    ]);
    expect(sanitized).toEqual([4000]);
    expect(invalid).toEqual([]);
    expect(reserved).toEqual([]);
  });
});
