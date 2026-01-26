/**
 * Unit tests for DaytonaSandboxProvider.
 *
 * These tests verify the provider interface without making actual API calls.
 */

import { describe, it, expect } from "vitest";
import { DaytonaSandboxProvider } from "./daytona";

describe("DaytonaSandboxProvider", () => {
  it("should require an API key", () => {
    expect(() => new DaytonaSandboxProvider("")).toThrow("DAYTONA_API_KEY is required");
  });

  it("should accept a valid API key", () => {
    const provider = new DaytonaSandboxProvider("test-api-key");
    expect(provider.name).toBe("daytona");
  });

  it("should use default target when not specified", () => {
    const provider = new DaytonaSandboxProvider("test-api-key");
    // The target is private, but we can verify the provider was created
    expect(provider.name).toBe("daytona");
  });

  it("should accept custom apiUrl and target", () => {
    const provider = new DaytonaSandboxProvider("test-api-key", {
      apiUrl: "https://custom.daytona.io/api",
      target: "eu",
    });
    expect(provider.name).toBe("daytona");
  });

  it("should have spawn method", () => {
    const provider = new DaytonaSandboxProvider("test-api-key");
    expect(typeof provider.spawn).toBe("function");
  });

  it("should have stop method", () => {
    const provider = new DaytonaSandboxProvider("test-api-key");
    expect(typeof provider.stop).toBe("function");
  });

  it("should have pause method", () => {
    const provider = new DaytonaSandboxProvider("test-api-key");
    expect(typeof provider.pause).toBe("function");
  });

  it("should have resume method", () => {
    const provider = new DaytonaSandboxProvider("test-api-key");
    expect(typeof provider.resume).toBe("function");
  });

  it("should have getStatus method", () => {
    const provider = new DaytonaSandboxProvider("test-api-key");
    expect(typeof provider.getStatus).toBe("function");
  });
});
