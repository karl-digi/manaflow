/**
 * Provider Health Monitor
 *
 * Tracks health metrics for AI providers including:
 * - Response latency (P50, P99)
 * - Success rate
 * - Circuit breaker state
 * - Health status (healthy/degraded/unhealthy)
 */

import {
  CircuitBreaker,
  createCircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitState,
} from "./circuit-breaker";

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface ProviderHealthMetrics {
  providerId: string;
  status: HealthStatus;
  circuitState: CircuitState;
  latencyP50: number;
  latencyP99: number;
  successRate: number;
  failureCount: number;
  totalRequests: number;
  lastCheck: number;
  lastError?: string;
}

export interface ProviderHealthConfig {
  /** TTL for cached health status in ms. Default: 300000 (5 min) */
  cacheTtlMs: number;
  /** Window size for calculating percentiles. Default: 100 */
  latencyWindowSize: number;
  /** Success rate threshold for "healthy" status. Default: 0.95 */
  healthyThreshold: number;
  /** Success rate threshold for "degraded" status. Default: 0.80 */
  degradedThreshold: number;
  /** Circuit breaker config override */
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
}

const DEFAULT_CONFIG: ProviderHealthConfig = {
  cacheTtlMs: 5 * 60 * 1000, // 5 minutes
  latencyWindowSize: 100,
  healthyThreshold: 0.95,
  degradedThreshold: 0.80,
};

interface ProviderState {
  circuitBreaker: CircuitBreaker;
  latencies: number[];
  successCount: number;
  failureCount: number;
  lastCheck: number;
  lastError?: string;
  cachedMetrics?: ProviderHealthMetrics;
}

export class ProviderHealthMonitor {
  private providers: Map<string, ProviderState> = new Map();
  private config: ProviderHealthConfig;

  constructor(config: Partial<ProviderHealthConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get or create provider state.
   */
  private getProviderState(providerId: string): ProviderState {
    let state = this.providers.get(providerId);
    if (!state) {
      state = {
        circuitBreaker: createCircuitBreaker({
          ...this.config.circuitBreakerConfig,
          onStateChange: (oldState, newState) => {
            console.log(
              `[ProviderHealth] ${providerId} circuit: ${oldState} -> ${newState}`
            );
          },
        }),
        latencies: [],
        successCount: 0,
        failureCount: 0,
        lastCheck: Date.now(),
      };
      this.providers.set(providerId, state);
    }
    return state;
  }

  /**
   * Record a successful request with latency.
   */
  recordSuccess(providerId: string, latencyMs: number): void {
    const state = this.getProviderState(providerId);
    state.circuitBreaker.recordSuccess();
    state.successCount++;
    state.lastCheck = Date.now();

    // Add to latency window
    state.latencies.push(latencyMs);
    if (state.latencies.length > this.config.latencyWindowSize) {
      state.latencies.shift();
    }

    // Invalidate cache
    state.cachedMetrics = undefined;
  }

  /**
   * Record a failed request.
   */
  recordFailure(providerId: string, error: Error): void {
    const state = this.getProviderState(providerId);
    state.circuitBreaker.recordFailure(error);
    state.failureCount++;
    state.lastCheck = Date.now();
    state.lastError = error.message;

    // Invalidate cache
    state.cachedMetrics = undefined;
  }

  /**
   * Check if requests to a provider can be attempted.
   */
  canAttempt(providerId: string): boolean {
    const state = this.getProviderState(providerId);
    return state.circuitBreaker.canAttempt();
  }

  /**
   * Execute a function with circuit breaker protection.
   * Automatically records latency and success/failure.
   *
   * Note: We track latency and health metrics separately from circuit breaker state.
   * The circuit breaker's execute() handles its own recordSuccess/recordFailure
   * for state transitions (closed/open/half-open). We track additional metrics
   * (latency percentiles, team-level success rate) that the circuit breaker doesn't.
   */
  async execute<T>(providerId: string, fn: () => Promise<T>): Promise<T> {
    const state = this.getProviderState(providerId);
    const startTime = Date.now();

    // Check circuit state first (canAttempt throws if open)
    if (!state.circuitBreaker.canAttempt()) {
      const stats = state.circuitBreaker.getStats();
      const timeoutMs = this.config.circuitBreakerConfig?.timeoutMs ?? 30000;
      const remainingMs = stats.lastFailureTime
        ? timeoutMs - (Date.now() - stats.lastFailureTime)
        : 0;
      const { CircuitOpenError } = await import("./circuit-breaker");
      throw new CircuitOpenError(
        `Circuit is open. Retry in ${Math.ceil(remainingMs / 1000)}s`,
        remainingMs
      );
    }

    try {
      // Execute the function directly (don't use circuitBreaker.execute to avoid double-recording)
      const result = await fn();
      const latencyMs = Date.now() - startTime;

      // Record success on circuit breaker for state transitions
      state.circuitBreaker.recordSuccess();

      // Track our own metrics (latency, success count) - no double-counting
      state.successCount++;
      state.lastCheck = Date.now();
      state.latencies.push(latencyMs);
      if (state.latencies.length > this.config.latencyWindowSize) {
        state.latencies.shift();
      }
      state.cachedMetrics = undefined;

      return result;
    } catch (error) {
      // Record failure on circuit breaker for state transitions
      state.circuitBreaker.recordFailure(
        error instanceof Error ? error : new Error(String(error))
      );

      // Track our own metrics - no double-counting
      state.failureCount++;
      state.lastCheck = Date.now();
      state.lastError = error instanceof Error ? error.message : String(error);
      state.cachedMetrics = undefined;

      throw error;
    }
  }

  /**
   * Get health metrics for a provider.
   */
  getMetrics(providerId: string): ProviderHealthMetrics {
    const state = this.getProviderState(providerId);

    // Return cached metrics if still valid
    if (
      state.cachedMetrics &&
      Date.now() - state.cachedMetrics.lastCheck < this.config.cacheTtlMs
    ) {
      return state.cachedMetrics;
    }

    const totalRequests = state.successCount + state.failureCount;
    const successRate = totalRequests > 0 ? state.successCount / totalRequests : 1;
    const circuitState = state.circuitBreaker.getState();

    // Calculate latency percentiles
    const { p50, p99 } = this.calculatePercentiles(state.latencies);

    // Determine health status
    let status: HealthStatus;
    if (circuitState === "open") {
      status = "unhealthy";
    } else if (circuitState === "half-open") {
      status = "degraded";
    } else if (successRate >= this.config.healthyThreshold) {
      status = "healthy";
    } else if (successRate >= this.config.degradedThreshold) {
      status = "degraded";
    } else {
      status = "unhealthy";
    }

    const metrics: ProviderHealthMetrics = {
      providerId,
      status,
      circuitState,
      latencyP50: p50,
      latencyP99: p99,
      successRate,
      failureCount: state.failureCount,
      totalRequests,
      lastCheck: state.lastCheck,
      lastError: state.lastError,
    };

    // Cache the metrics
    state.cachedMetrics = metrics;

    return metrics;
  }

  /**
   * Get health metrics for all tracked providers.
   */
  getAllMetrics(): ProviderHealthMetrics[] {
    return Array.from(this.providers.keys()).map((id) => this.getMetrics(id));
  }

  /**
   * Get the circuit breaker for a provider (for advanced usage).
   */
  getCircuitBreaker(providerId: string): CircuitBreaker {
    return this.getProviderState(providerId).circuitBreaker;
  }

  /**
   * Reset all metrics for a provider.
   */
  reset(providerId: string): void {
    const state = this.providers.get(providerId);
    if (state) {
      state.circuitBreaker.reset();
      state.latencies = [];
      state.successCount = 0;
      state.failureCount = 0;
      state.lastCheck = Date.now();
      state.lastError = undefined;
      state.cachedMetrics = undefined;
    }
  }

  /**
   * Reset all providers.
   */
  resetAll(): void {
    for (const providerId of this.providers.keys()) {
      this.reset(providerId);
    }
  }

  /**
   * Calculate P50 and P99 latency percentiles.
   */
  private calculatePercentiles(latencies: number[]): { p50: number; p99: number } {
    if (latencies.length === 0) {
      return { p50: 0, p99: 0 };
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const p50Index = Math.floor(sorted.length * 0.5);
    const p99Index = Math.floor(sorted.length * 0.99);

    return {
      p50: sorted[p50Index] ?? sorted[sorted.length - 1] ?? 0,
      p99: sorted[p99Index] ?? sorted[sorted.length - 1] ?? 0,
    };
  }
}

// Singleton instance
let monitorInstance: ProviderHealthMonitor | null = null;

/**
 * Get the singleton ProviderHealthMonitor instance.
 */
export function getProviderHealthMonitor(): ProviderHealthMonitor {
  if (!monitorInstance) {
    monitorInstance = new ProviderHealthMonitor();
  }
  return monitorInstance;
}

/**
 * Create a new ProviderHealthMonitor with custom config.
 */
export function createProviderHealthMonitor(
  config?: Partial<ProviderHealthConfig>
): ProviderHealthMonitor {
  return new ProviderHealthMonitor(config);
}
