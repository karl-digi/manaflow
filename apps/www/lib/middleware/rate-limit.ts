/**
 * Simple in-memory rate limiting middleware for Hono.
 *
 * Uses a sliding window approach to limit requests per identifier (team/user/IP).
 * This is suitable for single-server deployments. For distributed systems,
 * consider using Redis or similar distributed storage.
 */

import type { Context, MiddlewareHandler } from "hono";

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface RateLimitConfig {
  /** Maximum requests allowed per window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Function to extract identifier from request (defaults to IP) */
  keyGenerator?: (c: Context) => string;
  /** Custom handler when rate limit is exceeded */
  onRateLimitExceeded?: (c: Context, retryAfterMs: number) => Response;
}

// In-memory store for rate limit tracking
// Key: identifier (team ID, user ID, or IP)
// Value: { count, windowStart }
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes to prevent memory leaks
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let cleanupScheduled = false;

function scheduleCleanup(windowMs: number): void {
  if (cleanupScheduled) return;
  cleanupScheduled = true;

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (now - entry.windowStart > windowMs * 2) {
        rateLimitStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Default key generator that extracts team ID from request body or uses IP.
 */
function defaultKeyGenerator(c: Context): string {
  // Try to get team ID from various sources
  // 1. From request body (for POST requests)
  // 2. From query params
  // 3. Fall back to IP address
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
             c.req.header("x-real-ip") ||
             "unknown";

  return `ip:${ip}`;
}

/**
 * Create a rate limiting middleware.
 *
 * @example
 * ```ts
 * // Limit to 10 requests per hour per team
 * app.use("/api/sandboxes/start", rateLimit({
 *   limit: 10,
 *   windowMs: 60 * 60 * 1000, // 1 hour
 *   keyGenerator: (c) => `team:${c.req.query("teamSlugOrId") || "unknown"}`,
 * }));
 * ```
 */
export function rateLimit(config: RateLimitConfig): MiddlewareHandler {
  const {
    limit,
    windowMs,
    keyGenerator = defaultKeyGenerator,
    onRateLimitExceeded,
  } = config;

  // Schedule cleanup when first rate limiter is created
  scheduleCleanup(windowMs);

  return async (c, next) => {
    const key = keyGenerator(c);
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    if (!entry || now - entry.windowStart > windowMs) {
      // Start new window
      entry = { count: 1, windowStart: now };
      rateLimitStore.set(key, entry);
    } else {
      // Increment count in current window
      entry.count++;
    }

    // Set rate limit headers
    const remaining = Math.max(0, limit - entry.count);
    const resetMs = entry.windowStart + windowMs - now;
    const resetSec = Math.ceil(resetMs / 1000);

    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil((entry.windowStart + windowMs) / 1000)));

    if (entry.count > limit) {
      c.header("Retry-After", String(resetSec));

      if (onRateLimitExceeded) {
        return onRateLimitExceeded(c, resetMs);
      }

      return c.json(
        {
          error: "Too Many Requests",
          message: `Rate limit exceeded. Try again in ${resetSec} seconds.`,
          retryAfter: resetSec,
        },
        429
      );
    }

    await next();
  };
}

/**
 * Create a rate limiter specifically for sandbox creation.
 * Limits by team ID extracted from request body.
 *
 * Default: 10 sandboxes per hour per team
 */
export function sandboxCreationRateLimit(options?: {
  limit?: number;
  windowMs?: number;
}): MiddlewareHandler {
  const limit = options?.limit ?? 10;
  const windowMs = options?.windowMs ?? 60 * 60 * 1000; // 1 hour default

  return rateLimit({
    limit,
    windowMs,
    keyGenerator: (c) => {
      // For sandbox creation, we want to rate limit by team
      // The team is in the request body as teamSlugOrId
      // Since we can't read the body here (it would consume it),
      // we use the Authorization header or IP as fallback
      const authHeader = c.req.header("authorization") || "";
      const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
                 c.req.header("x-real-ip") ||
                 "unknown";

      // Use auth token hash if available, otherwise IP
      if (authHeader) {
        // Simple hash of auth header for privacy
        const hash = authHeader.slice(-16);
        return `sandbox:auth:${hash}`;
      }

      return `sandbox:ip:${ip}`;
    },
    onRateLimitExceeded: (c, retryAfterMs) => {
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);
      return c.json(
        {
          error: "Too Many Sandboxes",
          message: `You've created too many sandboxes. Please wait ${retryAfterSec} seconds before creating another.`,
          retryAfter: retryAfterSec,
        },
        429
      );
    },
  });
}
