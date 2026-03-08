import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  executeWithFallback,
  AllProvidersFailedError,
  createFallbackExecutor,
  type FallbackConfig,
} from "./fallback-executor";
import { ProviderHealthMonitor } from "./provider-health";

describe("FallbackExecutor", () => {
  let monitor: ProviderHealthMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    monitor = new ProviderHealthMonitor({
      circuitBreakerConfig: {
        failureThreshold: 2,
        timeoutMs: 10000,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("primary success path", () => {
    it("returns result from primary provider on success", async () => {
      const result = await executeWithFallback(
        monitor,
        { primaryProviderId: "provider-a" },
        async (providerId) => `result from ${providerId}`
      );

      expect(result.result).toBe("result from provider-a");
      expect(result.usedFallback).toBe(false);
      expect(result.providerId).toBe("provider-a");
      expect(result.attempts).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it("records success metrics for primary provider", async () => {
      await executeWithFallback(
        monitor,
        { primaryProviderId: "provider-a" },
        async () => "success"
      );

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.totalRequests).toBe(1);
    });
  });

  describe("fallback on primary failure", () => {
    it("falls back to secondary provider when primary fails", async () => {
      const fallbacks: FallbackConfig[] = [
        { modelName: "provider-b", priority: 1 },
      ];

      const result = await executeWithFallback(
        monitor,
        { primaryProviderId: "provider-a", fallbacks },
        async (providerId) => {
          if (providerId === "provider-a") {
            throw new Error("primary failed");
          }
          return `result from ${providerId}`;
        }
      );

      expect(result.result).toBe("result from provider-b");
      expect(result.usedFallback).toBe(true);
      expect(result.providerId).toBe("provider-b");
      expect(result.attempts).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].providerId).toBe("provider-a");
      expect(result.errors[0].error).toBe("primary failed");
    });

    it("respects fallback priority order", async () => {
      const fallbacks: FallbackConfig[] = [
        { modelName: "provider-c", priority: 3 },
        { modelName: "provider-b", priority: 1 },
        { modelName: "provider-d", priority: 2 },
      ];

      const callOrder: string[] = [];

      const result = await executeWithFallback(
        monitor,
        { primaryProviderId: "provider-a", fallbacks },
        async (providerId) => {
          callOrder.push(providerId);
          if (providerId !== "provider-d") {
            throw new Error(`${providerId} failed`);
          }
          return "success";
        }
      );

      // Order should be: primary, then sorted by priority (1, 2, 3)
      expect(callOrder).toEqual([
        "provider-a",
        "provider-b",
        "provider-d",
      ]);
      expect(result.providerId).toBe("provider-d");
      expect(result.attempts).toBe(3);
    });

    it("tries all fallbacks in order until success", async () => {
      const fallbacks: FallbackConfig[] = [
        { modelName: "provider-b", priority: 1 },
        { modelName: "provider-c", priority: 2 },
      ];

      const result = await executeWithFallback(
        monitor,
        { primaryProviderId: "provider-a", fallbacks },
        async (providerId) => {
          if (providerId === "provider-c") {
            return "success from c";
          }
          throw new Error(`${providerId} failed`);
        }
      );

      expect(result.result).toBe("success from c");
      expect(result.usedFallback).toBe(true);
      expect(result.attempts).toBe(3);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe("skipping providers with open circuits", () => {
    it("skips provider when circuit is open", async () => {
      // Open circuit for provider-a
      monitor.recordFailure("provider-a", new Error("fail 1"));
      monitor.recordFailure("provider-a", new Error("fail 2"));

      const fallbacks: FallbackConfig[] = [
        { modelName: "provider-b", priority: 1 },
      ];

      const callOrder: string[] = [];

      const result = await executeWithFallback(
        monitor,
        { primaryProviderId: "provider-a", fallbacks },
        async (providerId) => {
          callOrder.push(providerId);
          return `result from ${providerId}`;
        }
      );

      // provider-a should be skipped (circuit open)
      expect(callOrder).toEqual(["provider-b"]);
      expect(result.providerId).toBe("provider-b");
      expect(result.usedFallback).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain("Circuit open");
    });

    it("skips multiple providers with open circuits", async () => {
      // Open circuits for provider-a and provider-b
      monitor.recordFailure("provider-a", new Error("fail"));
      monitor.recordFailure("provider-a", new Error("fail"));
      monitor.recordFailure("provider-b", new Error("fail"));
      monitor.recordFailure("provider-b", new Error("fail"));

      const fallbacks: FallbackConfig[] = [
        { modelName: "provider-b", priority: 1 },
        { modelName: "provider-c", priority: 2 },
      ];

      const result = await executeWithFallback(
        monitor,
        { primaryProviderId: "provider-a", fallbacks },
        async (providerId) => `result from ${providerId}`
      );

      expect(result.providerId).toBe("provider-c");
      expect(result.errors).toHaveLength(2);
    });
  });

  describe("AllProvidersFailedError", () => {
    it("throws when all providers fail", async () => {
      const fallbacks: FallbackConfig[] = [
        { modelName: "provider-b", priority: 1 },
      ];

      await expect(
        executeWithFallback(
          monitor,
          { primaryProviderId: "provider-a", fallbacks },
          async (providerId) => {
            throw new Error(`${providerId} failed`);
          }
        )
      ).rejects.toThrow(AllProvidersFailedError);
    });

    it("includes all errors in AllProvidersFailedError", async () => {
      const fallbacks: FallbackConfig[] = [
        { modelName: "provider-b", priority: 1 },
        { modelName: "provider-c", priority: 2 },
      ];

      try {
        await executeWithFallback(
          monitor,
          { primaryProviderId: "provider-a", fallbacks },
          async (providerId) => {
            throw new Error(`${providerId} error`);
          }
        );
      } catch (error) {
        expect(error).toBeInstanceOf(AllProvidersFailedError);
        const allError = error as AllProvidersFailedError;
        expect(allError.errors).toHaveLength(3);
        expect(allError.errors[0]).toEqual({
          providerId: "provider-a",
          error: "provider-a error",
        });
        expect(allError.errors[1]).toEqual({
          providerId: "provider-b",
          error: "provider-b error",
        });
        expect(allError.errors[2]).toEqual({
          providerId: "provider-c",
          error: "provider-c error",
        });
        expect(allError.message).toContain("3 attempts");
      }
    });

    it("throws when all circuits are open", async () => {
      // Open circuits for all providers
      monitor.recordFailure("provider-a", new Error("fail"));
      monitor.recordFailure("provider-a", new Error("fail"));
      monitor.recordFailure("provider-b", new Error("fail"));
      monitor.recordFailure("provider-b", new Error("fail"));

      const fallbacks: FallbackConfig[] = [
        { modelName: "provider-b", priority: 1 },
      ];

      await expect(
        executeWithFallback(
          monitor,
          { primaryProviderId: "provider-a", fallbacks },
          async () => "never reached"
        )
      ).rejects.toThrow(AllProvidersFailedError);
    });

    it("includes attempt count in error message", async () => {
      try {
        await executeWithFallback(
          monitor,
          { primaryProviderId: "provider-a" },
          async () => {
            throw new Error("fail");
          }
        );
      } catch (error) {
        expect(error).toBeInstanceOf(AllProvidersFailedError);
        expect((error as Error).message).toContain("1 attempt");
      }
    });
  });

  describe("error handling", () => {
    it("converts non-Error objects to strings", async () => {
      const fallbacks: FallbackConfig[] = [
        { modelName: "provider-b", priority: 1 },
      ];

      const result = await executeWithFallback(
        monitor,
        { primaryProviderId: "provider-a", fallbacks },
        async (providerId) => {
          if (providerId === "provider-a") {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw "string error";
          }
          return "success";
        }
      );

      expect(result.errors[0].error).toBe("string error");
    });

    it("records failures in monitor for each failed attempt", async () => {
      const fallbacks: FallbackConfig[] = [
        { modelName: "provider-b", priority: 1 },
      ];

      await executeWithFallback(
        monitor,
        { primaryProviderId: "provider-a", fallbacks },
        async (providerId) => {
          if (providerId === "provider-a") {
            throw new Error("provider-a failed");
          }
          return "success";
        }
      );

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.failureCount).toBe(1);
    });
  });

  describe("no fallbacks", () => {
    it("works without fallbacks on success", async () => {
      const result = await executeWithFallback(
        monitor,
        { primaryProviderId: "provider-a" },
        async () => "primary success"
      );

      expect(result.result).toBe("primary success");
      expect(result.usedFallback).toBe(false);
    });

    it("throws when primary fails with no fallbacks", async () => {
      await expect(
        executeWithFallback(
          monitor,
          { primaryProviderId: "provider-a" },
          async () => {
            throw new Error("primary failed");
          }
        )
      ).rejects.toThrow(AllProvidersFailedError);
    });
  });

  describe("createFallbackExecutor factory", () => {
    it("creates executor bound to health monitor", async () => {
      const executor = createFallbackExecutor(monitor);

      const result = await executor.execute(
        { primaryProviderId: "provider-a" },
        async () => "success"
      );

      expect(result.result).toBe("success");
    });

    it("uses same monitor instance for all executions", async () => {
      const executor = createFallbackExecutor(monitor);

      await executor.execute(
        { primaryProviderId: "provider-a" },
        async () => "first"
      );

      await executor.execute(
        { primaryProviderId: "provider-a" },
        async () => "second"
      );

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.totalRequests).toBe(2);
    });
  });
});
