/**
 * Resilience Module
 *
 * Provides fault tolerance patterns for provider APIs:
 * - Circuit breaker for preventing cascade failures
 * - Health monitoring for tracking provider status
 * - Fallback execution for automatic provider switching
 */

export {
  CircuitBreaker,
  CircuitOpenError,
  createCircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitState,
} from "./circuit-breaker";

export {
  ProviderHealthMonitor,
  createProviderHealthMonitor,
  getProviderHealthMonitor,
  type HealthStatus,
  type ProviderHealthConfig,
  type ProviderHealthMetrics,
} from "./provider-health";

export {
  executeWithFallback,
  createFallbackExecutor,
  AllProvidersFailedError,
  type FallbackConfig,
  type FallbackResult,
  type ExecutionOptions,
} from "./fallback-executor";
