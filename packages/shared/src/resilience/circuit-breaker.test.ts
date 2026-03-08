import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  CircuitBreaker,
  CircuitOpenError,
  createCircuitBreaker,
  type CircuitBreakerConfig,
} from "./circuit-breaker";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("starts in closed state", () => {
      const cb = new CircuitBreaker();
      expect(cb.getState()).toBe("closed");
    });

    it("allows requests when closed", () => {
      const cb = new CircuitBreaker();
      expect(cb.canAttempt()).toBe(true);
    });

    it("initializes with zero counters", () => {
      const cb = new CircuitBreaker();
      const stats = cb.getStats();
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalFailures).toBe(0);
      expect(stats.totalSuccesses).toBe(0);
    });
  });

  describe("state transitions: closed -> open", () => {
    it("opens after reaching failure threshold", () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });

      // Record failures up to threshold
      cb.recordFailure(new Error("fail 1"));
      expect(cb.getState()).toBe("closed");
      cb.recordFailure(new Error("fail 2"));
      expect(cb.getState()).toBe("closed");
      cb.recordFailure(new Error("fail 3"));
      expect(cb.getState()).toBe("open");
    });

    it("rejects requests when open", () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure(new Error("fail"));
      expect(cb.getState()).toBe("open");
      expect(cb.canAttempt()).toBe(false);
    });

    it("resets failure count on success in closed state", () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });

      cb.recordFailure(new Error("fail 1"));
      cb.recordFailure(new Error("fail 2"));
      expect(cb.getStats().failureCount).toBe(2);

      cb.recordSuccess();
      expect(cb.getStats().failureCount).toBe(0);

      // Now need 3 more failures to open
      cb.recordFailure(new Error("fail 1"));
      cb.recordFailure(new Error("fail 2"));
      expect(cb.getState()).toBe("closed");
      cb.recordFailure(new Error("fail 3"));
      expect(cb.getState()).toBe("open");
    });
  });

  describe("state transitions: open -> half-open", () => {
    it("transitions to half-open after timeout", () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        timeoutMs: 5000,
      });

      cb.recordFailure(new Error("fail"));
      expect(cb.getState()).toBe("open");
      expect(cb.canAttempt()).toBe(false);

      // Advance time past timeout
      vi.advanceTimersByTime(5000);
      expect(cb.canAttempt()).toBe(true);
      expect(cb.getState()).toBe("half-open");
    });

    it("remains open before timeout elapses", () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        timeoutMs: 5000,
      });

      cb.recordFailure(new Error("fail"));
      vi.advanceTimersByTime(4999);
      expect(cb.canAttempt()).toBe(false);
      expect(cb.getState()).toBe("open");
    });
  });

  describe("state transitions: half-open -> closed", () => {
    it("closes after success threshold in half-open", () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 2,
        timeoutMs: 1000,
      });

      // Open the circuit
      cb.recordFailure(new Error("fail"));
      expect(cb.getState()).toBe("open");

      // Wait for half-open
      vi.advanceTimersByTime(1000);
      cb.canAttempt(); // Trigger transition check
      expect(cb.getState()).toBe("half-open");

      // Record successes
      cb.recordSuccess();
      expect(cb.getState()).toBe("half-open");
      cb.recordSuccess();
      expect(cb.getState()).toBe("closed");
    });
  });

  describe("state transitions: half-open -> open", () => {
    it("opens immediately on any failure in half-open", () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 3,
        timeoutMs: 1000,
      });

      // Open the circuit
      cb.recordFailure(new Error("fail"));
      vi.advanceTimersByTime(1000);
      cb.canAttempt();
      expect(cb.getState()).toBe("half-open");

      // Record success then failure
      cb.recordSuccess();
      expect(cb.getState()).toBe("half-open");
      cb.recordFailure(new Error("fail again"));
      expect(cb.getState()).toBe("open");
    });
  });

  describe("execute wrapper", () => {
    it("returns result on success", async () => {
      const cb = new CircuitBreaker();
      const result = await cb.execute(async () => "success");
      expect(result).toBe("success");
    });

    it("records success on successful execution", async () => {
      const cb = new CircuitBreaker();
      await cb.execute(async () => "ok");
      const stats = cb.getStats();
      expect(stats.totalSuccesses).toBe(1);
      expect(stats.totalRequests).toBe(1);
    });

    it("rethrows error and records failure", async () => {
      const cb = new CircuitBreaker();
      await expect(cb.execute(async () => {
        throw new Error("test error");
      })).rejects.toThrow("test error");

      const stats = cb.getStats();
      expect(stats.totalFailures).toBe(1);
    });

    it("throws CircuitOpenError when circuit is open", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        timeoutMs: 5000,
      });

      cb.recordFailure(new Error("fail"));
      vi.advanceTimersByTime(1000); // Still within timeout

      await expect(cb.execute(async () => "never reached")).rejects.toThrow(
        CircuitOpenError
      );
    });

    it("CircuitOpenError includes retry info", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        timeoutMs: 5000,
      });

      cb.recordFailure(new Error("fail"));
      vi.advanceTimersByTime(1000);

      try {
        await cb.execute(async () => "never");
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitOpenError);
        const openError = error as CircuitOpenError;
        expect(openError.retryAfterMs).toBe(4000); // 5000 - 1000
        expect(openError.message).toContain("4s");
      }
    });

    it("allows execution after timeout in open state", async () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        timeoutMs: 1000,
      });

      cb.recordFailure(new Error("fail"));
      vi.advanceTimersByTime(1000);

      const result = await cb.execute(async () => "recovered");
      expect(result).toBe("recovered");
      expect(cb.getState()).toBe("half-open");
    });
  });

  describe("forceOpen / forceClosed", () => {
    it("forceOpen transitions to open state", () => {
      const cb = new CircuitBreaker();
      expect(cb.getState()).toBe("closed");

      cb.forceOpen();
      expect(cb.getState()).toBe("open");
      expect(cb.canAttempt()).toBe(false);
    });

    it("forceClosed transitions to closed state and resets counters", () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });

      cb.recordFailure(new Error("fail"));
      expect(cb.getState()).toBe("open");

      cb.forceClosed();
      expect(cb.getState()).toBe("closed");
      expect(cb.canAttempt()).toBe(true);
      expect(cb.getStats().failureCount).toBe(0);
    });
  });

  describe("reset", () => {
    it("resets all state to initial values", () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });

      cb.recordFailure(new Error("fail"));
      cb.recordSuccess();
      cb.forceOpen();

      cb.reset();

      expect(cb.getState()).toBe("closed");
      const stats = cb.getStats();
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.lastFailureTime).toBeNull();
      expect(stats.lastSuccessTime).toBeNull();
    });
  });

  describe("state change callback", () => {
    it("calls onStateChange when state transitions", () => {
      const onStateChange = vi.fn();
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        onStateChange,
      });

      cb.recordFailure(new Error("fail"));
      expect(onStateChange).toHaveBeenCalledWith("closed", "open", {
        failureCount: 1,
        successCount: 0,
      });
    });

    it("does not call onStateChange for same state", () => {
      const onStateChange = vi.fn();
      const cb = new CircuitBreaker({
        failureThreshold: 3,
        onStateChange,
      });

      cb.recordFailure(new Error("fail 1"));
      cb.recordFailure(new Error("fail 2"));
      // Still closed, no state change
      expect(onStateChange).not.toHaveBeenCalled();
    });
  });

  describe("getStats", () => {
    it("tracks total requests, successes, and failures", () => {
      const cb = new CircuitBreaker({ failureThreshold: 10 });

      cb.recordSuccess();
      cb.recordSuccess();
      cb.recordFailure(new Error("fail"));

      const stats = cb.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.totalSuccesses).toBe(2);
      expect(stats.totalFailures).toBe(1);
    });

    it("tracks timestamps", () => {
      const cb = new CircuitBreaker();

      const beforeSuccess = Date.now();
      cb.recordSuccess();
      const afterSuccess = Date.now();
      expect(cb.getStats().lastSuccessTime).toBeGreaterThanOrEqual(beforeSuccess);
      expect(cb.getStats().lastSuccessTime).toBeLessThanOrEqual(afterSuccess);

      const beforeFailure = Date.now();
      cb.recordFailure(new Error("fail"));
      const afterFailure = Date.now();
      expect(cb.getStats().lastFailureTime).toBeGreaterThanOrEqual(beforeFailure);
      expect(cb.getStats().lastFailureTime).toBeLessThanOrEqual(afterFailure);
    });
  });

  describe("createCircuitBreaker factory", () => {
    it("creates a CircuitBreaker with default config", () => {
      const cb = createCircuitBreaker();
      expect(cb).toBeInstanceOf(CircuitBreaker);
      expect(cb.getState()).toBe("closed");
    });

    it("creates a CircuitBreaker with custom config", () => {
      const config: Partial<CircuitBreakerConfig> = {
        failureThreshold: 10,
        successThreshold: 5,
        timeoutMs: 60000,
      };
      const cb = createCircuitBreaker(config);
      expect(cb).toBeInstanceOf(CircuitBreaker);
    });
  });
});
