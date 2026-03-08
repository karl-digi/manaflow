import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  ProviderHealthMonitor,
  createProviderHealthMonitor,
  type ProviderHealthConfig,
} from "./provider-health";
import { CircuitOpenError } from "./circuit-breaker";

describe("ProviderHealthMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("creates provider state on first access", () => {
      const monitor = new ProviderHealthMonitor();
      const metrics = monitor.getMetrics("test-provider");

      expect(metrics.providerId).toBe("test-provider");
      expect(metrics.status).toBe("healthy");
      expect(metrics.circuitState).toBe("closed");
      expect(metrics.successRate).toBe(1); // No failures = 100% success
      expect(metrics.totalRequests).toBe(0);
    });

    it("allows attempts for new providers", () => {
      const monitor = new ProviderHealthMonitor();
      expect(monitor.canAttempt("new-provider")).toBe(true);
    });
  });

  describe("success recording", () => {
    it("records latency on success", () => {
      const monitor = new ProviderHealthMonitor();

      monitor.recordSuccess("provider-a", 100);
      monitor.recordSuccess("provider-a", 200);
      monitor.recordSuccess("provider-a", 150);

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.totalRequests).toBe(3);
    });

    it("tracks success count", () => {
      const monitor = new ProviderHealthMonitor();

      monitor.recordSuccess("provider-a", 100);
      monitor.recordSuccess("provider-a", 100);

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.successRate).toBe(1);
      expect(metrics.failureCount).toBe(0);
    });
  });

  describe("failure recording", () => {
    it("tracks failure count", () => {
      const monitor = new ProviderHealthMonitor();

      monitor.recordFailure("provider-a", new Error("fail 1"));
      monitor.recordFailure("provider-a", new Error("fail 2"));

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.failureCount).toBe(2);
      expect(metrics.successRate).toBe(0);
    });

    it("stores last error message", () => {
      const monitor = new ProviderHealthMonitor();

      monitor.recordFailure("provider-a", new Error("first error"));
      monitor.recordFailure("provider-a", new Error("second error"));

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.lastError).toBe("second error");
    });
  });

  describe("success rate calculation", () => {
    it("calculates correct success rate", () => {
      const monitor = new ProviderHealthMonitor();

      monitor.recordSuccess("provider-a", 100);
      monitor.recordSuccess("provider-a", 100);
      monitor.recordFailure("provider-a", new Error("fail"));

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.successRate).toBeCloseTo(2 / 3);
    });

    it("returns 1 for no requests", () => {
      const monitor = new ProviderHealthMonitor();
      const metrics = monitor.getMetrics("new-provider");
      expect(metrics.successRate).toBe(1);
    });
  });

  describe("latency percentile calculation", () => {
    it("calculates P50 from latency window", () => {
      const monitor = new ProviderHealthMonitor();

      // Record latencies: 10, 20, 30, 40, 50
      [10, 20, 30, 40, 50].forEach((lat) =>
        monitor.recordSuccess("provider-a", lat)
      );

      const metrics = monitor.getMetrics("provider-a");
      // P50 of [10, 20, 30, 40, 50] is 30 (index 2)
      expect(metrics.latencyP50).toBe(30);
    });

    it("calculates P99 from latency window", () => {
      const monitor = new ProviderHealthMonitor();

      // Record 100 latencies: 1, 2, 3, ..., 100
      for (let i = 1; i <= 100; i++) {
        monitor.recordSuccess("provider-a", i);
      }

      const metrics = monitor.getMetrics("provider-a");
      // P99 index = floor(100 * 0.99) = 99, value = 100
      expect(metrics.latencyP99).toBe(100);
    });

    it("returns 0 for empty latency window", () => {
      const monitor = new ProviderHealthMonitor();
      const metrics = monitor.getMetrics("new-provider");
      expect(metrics.latencyP50).toBe(0);
      expect(metrics.latencyP99).toBe(0);
    });

    it("respects latency window size", () => {
      const monitor = new ProviderHealthMonitor({ latencyWindowSize: 3 });

      // Record 5 latencies, only last 3 should be kept
      [100, 200, 300, 400, 500].forEach((lat) =>
        monitor.recordSuccess("provider-a", lat)
      );

      const metrics = monitor.getMetrics("provider-a");
      // Window contains [300, 400, 500], P50 = 400
      expect(metrics.latencyP50).toBe(400);
    });
  });

  describe("health status determination", () => {
    it("returns healthy for high success rate", () => {
      const monitor = new ProviderHealthMonitor({
        healthyThreshold: 0.95,
        degradedThreshold: 0.80,
      });

      // 96% success rate
      for (let i = 0; i < 96; i++) {
        monitor.recordSuccess("provider-a", 100);
      }
      for (let i = 0; i < 4; i++) {
        monitor.recordFailure("provider-a", new Error("fail"));
      }

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.status).toBe("healthy");
    });

    it("returns degraded for medium success rate", () => {
      const monitor = new ProviderHealthMonitor({
        healthyThreshold: 0.95,
        degradedThreshold: 0.80,
        // High failure threshold so circuit doesn't open during test
        circuitBreakerConfig: { failureThreshold: 100 },
      });

      // 85% success rate
      for (let i = 0; i < 85; i++) {
        monitor.recordSuccess("provider-a", 100);
      }
      for (let i = 0; i < 15; i++) {
        monitor.recordFailure("provider-a", new Error("fail"));
      }

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.status).toBe("degraded");
    });

    it("returns unhealthy for low success rate", () => {
      const monitor = new ProviderHealthMonitor({
        healthyThreshold: 0.95,
        degradedThreshold: 0.80,
      });

      // 70% success rate
      for (let i = 0; i < 70; i++) {
        monitor.recordSuccess("provider-a", 100);
      }
      for (let i = 0; i < 30; i++) {
        monitor.recordFailure("provider-a", new Error("fail"));
      }

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.status).toBe("unhealthy");
    });

    it("returns unhealthy when circuit is open", () => {
      const monitor = new ProviderHealthMonitor({
        circuitBreakerConfig: { failureThreshold: 1 },
      });

      monitor.recordFailure("provider-a", new Error("fail"));

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.circuitState).toBe("open");
      expect(metrics.status).toBe("unhealthy");
    });

    it("returns degraded when circuit is half-open", () => {
      const monitor = new ProviderHealthMonitor({
        circuitBreakerConfig: {
          failureThreshold: 1,
          timeoutMs: 1000,
        },
      });

      monitor.recordFailure("provider-a", new Error("fail"));
      vi.advanceTimersByTime(1000);
      monitor.canAttempt("provider-a"); // Trigger half-open transition

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.circuitState).toBe("half-open");
      expect(metrics.status).toBe("degraded");
    });
  });

  describe("cache behavior", () => {
    it("returns cached metrics within TTL", () => {
      const monitor = new ProviderHealthMonitor({ cacheTtlMs: 5000 });

      monitor.recordSuccess("provider-a", 100);
      const metrics1 = monitor.getMetrics("provider-a");
      const metrics2 = monitor.getMetrics("provider-a");

      // Should be same object reference (cached)
      expect(metrics1).toBe(metrics2);
    });

    it("invalidates cache on new success", () => {
      const monitor = new ProviderHealthMonitor({ cacheTtlMs: 5000 });

      monitor.recordSuccess("provider-a", 100);
      const metrics1 = monitor.getMetrics("provider-a");

      monitor.recordSuccess("provider-a", 200);
      const metrics2 = monitor.getMetrics("provider-a");

      expect(metrics1).not.toBe(metrics2);
    });

    it("invalidates cache on new failure", () => {
      const monitor = new ProviderHealthMonitor({ cacheTtlMs: 5000 });

      monitor.recordSuccess("provider-a", 100);
      const metrics1 = monitor.getMetrics("provider-a");

      monitor.recordFailure("provider-a", new Error("fail"));
      const metrics2 = monitor.getMetrics("provider-a");

      expect(metrics1).not.toBe(metrics2);
    });
  });

  describe("execute method", () => {
    it("records success with latency on successful execution", async () => {
      vi.useRealTimers(); // Use real timers for this test
      const monitor = new ProviderHealthMonitor();

      const result = await monitor.execute("provider-a", async () => {
        return "success";
      });

      expect(result).toBe("success");
      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.totalRequests).toBe(1);
      // Latency should be recorded
      vi.useFakeTimers(); // Restore fake timers
    });

    it("records failure on failed execution", async () => {
      const monitor = new ProviderHealthMonitor();

      await expect(
        monitor.execute("provider-a", async () => {
          throw new Error("operation failed");
        })
      ).rejects.toThrow("operation failed");

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.failureCount).toBe(1);
      expect(metrics.lastError).toBe("operation failed");
    });

    it("throws CircuitOpenError when circuit is open", async () => {
      const monitor = new ProviderHealthMonitor({
        circuitBreakerConfig: { failureThreshold: 1, timeoutMs: 10000 },
      });

      monitor.recordFailure("provider-a", new Error("initial fail"));
      vi.advanceTimersByTime(1000);

      await expect(
        monitor.execute("provider-a", async () => "should not run")
      ).rejects.toThrow(CircuitOpenError);
    });
  });

  describe("canAttempt", () => {
    it("returns true for healthy provider", () => {
      const monitor = new ProviderHealthMonitor();
      monitor.recordSuccess("provider-a", 100);
      expect(monitor.canAttempt("provider-a")).toBe(true);
    });

    it("returns false when circuit is open", () => {
      const monitor = new ProviderHealthMonitor({
        circuitBreakerConfig: { failureThreshold: 1, timeoutMs: 10000 },
      });

      monitor.recordFailure("provider-a", new Error("fail"));
      expect(monitor.canAttempt("provider-a")).toBe(false);
    });
  });

  describe("reset methods", () => {
    it("reset clears metrics for specific provider", () => {
      const monitor = new ProviderHealthMonitor();

      monitor.recordSuccess("provider-a", 100);
      monitor.recordFailure("provider-a", new Error("fail"));

      monitor.reset("provider-a");

      const metrics = monitor.getMetrics("provider-a");
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.failureCount).toBe(0);
      expect(metrics.successRate).toBe(1);
    });

    it("resetAll clears all providers", () => {
      const monitor = new ProviderHealthMonitor();

      monitor.recordSuccess("provider-a", 100);
      monitor.recordSuccess("provider-b", 100);
      monitor.recordFailure("provider-a", new Error("fail"));

      monitor.resetAll();

      expect(monitor.getMetrics("provider-a").totalRequests).toBe(0);
      expect(monitor.getMetrics("provider-b").totalRequests).toBe(0);
    });
  });

  describe("getAllMetrics", () => {
    it("returns metrics for all tracked providers", () => {
      const monitor = new ProviderHealthMonitor();

      monitor.recordSuccess("provider-a", 100);
      monitor.recordSuccess("provider-b", 200);
      monitor.recordSuccess("provider-c", 300);

      const allMetrics = monitor.getAllMetrics();
      expect(allMetrics).toHaveLength(3);
      expect(allMetrics.map((m) => m.providerId).sort()).toEqual([
        "provider-a",
        "provider-b",
        "provider-c",
      ]);
    });
  });

  describe("getCircuitBreaker", () => {
    it("returns circuit breaker for provider", () => {
      const monitor = new ProviderHealthMonitor();
      monitor.recordSuccess("provider-a", 100);

      const cb = monitor.getCircuitBreaker("provider-a");
      expect(cb.getState()).toBe("closed");
    });
  });

  describe("createProviderHealthMonitor factory", () => {
    it("creates monitor with default config", () => {
      const monitor = createProviderHealthMonitor();
      expect(monitor).toBeInstanceOf(ProviderHealthMonitor);
    });

    it("creates monitor with custom config", () => {
      const config: Partial<ProviderHealthConfig> = {
        cacheTtlMs: 60000,
        latencyWindowSize: 50,
        healthyThreshold: 0.99,
        degradedThreshold: 0.90,
      };
      const monitor = createProviderHealthMonitor(config);
      expect(monitor).toBeInstanceOf(ProviderHealthMonitor);
    });
  });
});
