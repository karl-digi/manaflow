/**
 * Fallback Executor
 *
 * Executes provider operations with automatic fallback to alternative providers
 * when the primary provider fails or circuit is open.
 */

import type { ProviderHealthMonitor, HealthStatus } from "./provider-health";
import { CircuitOpenError } from "./circuit-breaker";

export interface FallbackConfig {
  modelName: string;
  priority: number;
}

export interface FallbackResult<T> {
  result: T;
  usedFallback: boolean;
  providerId: string;
  attempts: number;
  errors: Array<{ providerId: string; error: string }>;
}

export interface ExecutionOptions {
  /** Primary provider ID */
  primaryProviderId: string;
  /** Fallback providers in priority order */
  fallbacks?: FallbackConfig[];
  /** Whether to throw on all failures (default: true) */
  throwOnAllFail?: boolean;
  /** Callback to get provider health status */
  getProviderStatus?: (providerId: string) => HealthStatus;
}

/**
 * Execute an operation with fallback support.
 * Tries the primary provider first, then falls back to alternatives if available.
 *
 * @param healthMonitor - Provider health monitor instance
 * @param options - Execution options
 * @param operation - The operation to execute (receives providerId)
 */
export async function executeWithFallback<T>(
  healthMonitor: ProviderHealthMonitor,
  options: ExecutionOptions,
  operation: (providerId: string) => Promise<T>
): Promise<FallbackResult<T>> {
  const { primaryProviderId, fallbacks = [], throwOnAllFail = true } = options;

  // Build provider order: primary first, then fallbacks sorted by priority
  const providerOrder = [
    primaryProviderId,
    ...fallbacks
      .sort((a, b) => a.priority - b.priority)
      .map((f) => f.modelName),
  ];

  const errors: Array<{ providerId: string; error: string }> = [];
  let attempts = 0;

  for (const providerId of providerOrder) {
    attempts++;

    // Check if we can attempt this provider
    if (!healthMonitor.canAttempt(providerId)) {
      const metrics = healthMonitor.getMetrics(providerId);
      errors.push({
        providerId,
        error: `Circuit open (state: ${metrics.circuitState})`,
      });
      continue;
    }

    try {
      const result = await healthMonitor.execute(providerId, () =>
        operation(providerId)
      );

      return {
        result,
        usedFallback: providerId !== primaryProviderId,
        providerId,
        attempts,
        errors,
      };
    } catch (error) {
      const errorMessage =
        error instanceof CircuitOpenError
          ? `Circuit open: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);

      errors.push({
        providerId,
        error: errorMessage,
      });

      // Continue to next fallback
      console.error(
        `[FallbackExecutor] Provider ${providerId} failed: ${errorMessage}`
      );
    }
  }

  // All providers failed
  if (throwOnAllFail) {
    const errorSummary = errors
      .map((e) => `${e.providerId}: ${e.error}`)
      .join("; ");
    throw new AllProvidersFailedError(
      `All providers failed after ${attempts} attempts: ${errorSummary}`,
      errors
    );
  }

  // Return a failure result if not throwing
  throw new AllProvidersFailedError(
    `All ${attempts} providers failed`,
    errors
  );
}

/**
 * Error thrown when all providers (including fallbacks) fail.
 */
export class AllProvidersFailedError extends Error {
  constructor(
    message: string,
    public readonly errors: Array<{ providerId: string; error: string }>
  ) {
    super(message);
    this.name = "AllProvidersFailedError";
  }
}

/**
 * Create a fallback executor bound to a specific health monitor.
 */
export function createFallbackExecutor(healthMonitor: ProviderHealthMonitor) {
  return {
    execute: <T>(
      options: ExecutionOptions,
      operation: (providerId: string) => Promise<T>
    ) => executeWithFallback(healthMonitor, options, operation),
  };
}
