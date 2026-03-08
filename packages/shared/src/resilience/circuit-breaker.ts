/**
 * Circuit Breaker Pattern Implementation
 *
 * Provides resilience for provider API calls by preventing cascade failures.
 * Follows the standard circuit breaker pattern with three states:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit is tripped, requests fail immediately
 * - HALF_OPEN: Testing if service recovered, limited requests pass through
 */

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit. Default: 5 */
  failureThreshold: number;
  /** Number of successes in half-open state to close circuit. Default: 2 */
  successThreshold: number;
  /** Time in ms before attempting recovery (half-open). Default: 30000 */
  timeoutMs: number;
  /** Optional callback when state changes */
  onStateChange?: (
    oldState: CircuitState,
    newState: CircuitState,
    context: { failureCount: number; successCount: number }
  ) => void;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeoutMs: 30000,
};

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private totalRequests = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if a request can be attempted.
   * Returns false if circuit is open and timeout hasn't elapsed.
   */
  canAttempt(): boolean {
    if (this.state === "closed") {
      return true;
    }

    if (this.state === "open") {
      // Check if timeout has elapsed to transition to half-open
      if (this.lastFailureTime !== null) {
        const elapsed = Date.now() - this.lastFailureTime;
        if (elapsed >= this.config.timeoutMs) {
          this.transitionTo("half-open");
          return true;
        }
      }
      return false;
    }

    // half-open state allows requests
    return true;
  }

  /**
   * Record a successful request.
   * May transition from half-open to closed if success threshold is met.
   */
  recordSuccess(): void {
    this.totalRequests++;
    this.totalSuccesses++;
    this.lastSuccessTime = Date.now();
    this.successCount++;

    if (this.state === "half-open") {
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo("closed");
      }
    } else if (this.state === "closed") {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed request.
   * May transition from closed to open if failure threshold is met,
   * or from half-open to open on any failure.
   */
  recordFailure(error: Error): void {
    this.totalRequests++;
    this.totalFailures++;
    this.lastFailureTime = Date.now();
    this.failureCount++;

    if (this.state === "closed") {
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo("open");
      }
    } else if (this.state === "half-open") {
      // Any failure in half-open state trips the circuit again
      this.transitionTo("open");
    }

    // Log the error for debugging
    console.error(
      `[CircuitBreaker] Failure recorded (state=${this.state}, count=${this.failureCount}):`,
      error.message
    );
  }

  /**
   * Execute a function with circuit breaker protection.
   * Throws CircuitOpenError if circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canAttempt()) {
      const remainingMs = this.lastFailureTime
        ? this.config.timeoutMs - (Date.now() - this.lastFailureTime)
        : 0;
      throw new CircuitOpenError(
        `Circuit is open. Retry in ${Math.ceil(remainingMs / 1000)}s`,
        remainingMs
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get current circuit breaker statistics.
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Get current state.
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Force circuit to open state (for testing or manual intervention).
   */
  forceOpen(): void {
    this.transitionTo("open");
    this.lastFailureTime = Date.now();
  }

  /**
   * Force circuit to closed state (for testing or manual intervention).
   */
  forceClosed(): void {
    this.transitionTo("closed");
    this.failureCount = 0;
    this.successCount = 0;
  }

  /**
   * Reset all counters and return to closed state.
   */
  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;

    // Reset counters on state transition
    if (newState === "closed") {
      this.failureCount = 0;
      this.successCount = 0;
    } else if (newState === "half-open") {
      this.successCount = 0;
    } else if (newState === "open") {
      this.successCount = 0;
    }

    // Notify callback if configured
    if (this.config.onStateChange) {
      this.config.onStateChange(oldState, newState, {
        failureCount: this.failureCount,
        successCount: this.successCount,
      });
    }

    console.log(`[CircuitBreaker] State transition: ${oldState} -> ${newState}`);
  }
}

/**
 * Error thrown when circuit is open.
 */
export class CircuitOpenError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number
  ) {
    super(message);
    this.name = "CircuitOpenError";
  }
}

/**
 * Create a circuit breaker with custom configuration.
 */
export function createCircuitBreaker(
  config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  return new CircuitBreaker(config);
}
