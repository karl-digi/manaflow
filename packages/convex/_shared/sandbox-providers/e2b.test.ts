/**
 * Unit tests for E2BSandboxProvider.
 *
 * These tests verify the provider interface without making actual API calls.
 */

import { describe, it, expect } from "vitest";
import { E2BSandboxProvider } from "./e2b";

describe("E2BSandboxProvider", () => {
  it("should require an API key", () => {
    expect(() => new E2BSandboxProvider("")).toThrow("E2B_API_KEY is required");
  });

  it("should accept a valid API key", () => {
    const provider = new E2BSandboxProvider("test-api-key");
    expect(provider.name).toBe("e2b");
  });

  it("should have spawn method", () => {
    const provider = new E2BSandboxProvider("test-api-key");
    expect(typeof provider.spawn).toBe("function");
  });

  it("should have stop method", () => {
    const provider = new E2BSandboxProvider("test-api-key");
    expect(typeof provider.stop).toBe("function");
  });

  it("should have pause method", () => {
    const provider = new E2BSandboxProvider("test-api-key");
    expect(typeof provider.pause).toBe("function");
  });

  it("should have resume method", () => {
    const provider = new E2BSandboxProvider("test-api-key");
    expect(typeof provider.resume).toBe("function");
  });

  it("should have getStatus method", () => {
    const provider = new E2BSandboxProvider("test-api-key");
    expect(typeof provider.getStatus).toBe("function");
  });
});
