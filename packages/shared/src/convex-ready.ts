/**
 * Module for coordinating startup timing between Convex initialization
 * and dependent services.
 */

const onConvexReadyListeners: (() => void)[] = [];

/**
 * Returns a promise that resolves when Convex is ready.
 * Use this to wait for Convex initialization before starting
 * dependent services.
 *
 * @returns Promise that resolves to true when emitConvexReady() is called
 *
 * @example
 * ```ts
 * await onConvexReady();
 * // Convex is now initialized, safe to proceed
 * ```
 */
export async function onConvexReady(): Promise<boolean> {
  return new Promise((resolve) => {
    onConvexReadyListeners.push(() => resolve(true));
  });
}

/**
 * Signals that Convex has finished initializing.
 * Call this after Convex setup completes to unblock
 * any services waiting via onConvexReady().
 */
export function emitConvexReady(): void {
  onConvexReadyListeners.forEach((listener) => listener());
}
