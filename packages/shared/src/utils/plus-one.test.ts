import { describe, it, expect } from "vitest";
import { plusOne } from "./plus-one";

describe("plusOne", () => {
  it("should increment positive numbers", () => {
    expect(plusOne(0)).toBe(1);
    expect(plusOne(1)).toBe(2);
    expect(plusOne(42)).toBe(43);
  });

  it("should increment negative numbers", () => {
    expect(plusOne(-1)).toBe(0);
    expect(plusOne(-5)).toBe(-4);
  });

  it("should handle decimal numbers", () => {
    expect(plusOne(1.5)).toBe(2.5);
    expect(plusOne(0.1)).toBeCloseTo(1.1);
  });

  it("should handle large numbers", () => {
    expect(plusOne(Number.MAX_SAFE_INTEGER - 1)).toBe(Number.MAX_SAFE_INTEGER);
  });
});
