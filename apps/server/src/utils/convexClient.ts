import {
  convexClientCache,
  ConvexHttpClient,
} from "@cmux/shared/node/convex-cache";
import { getAuthToken } from "./requestContext";
import { env } from "./server-env";

// Return a Convex client bound to the current auth context (requires auth)
export function getConvex() {
  const auth = getAuthToken();
  if (!auth) {
    throw new Error("No auth token found");
  }

  // Try to get from cache first
  const cachedClient = convexClientCache.get(auth, env.NEXT_PUBLIC_CONVEX_URL);
  if (cachedClient) {
    return cachedClient;
  }

  // Create new client and cache it
  const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
  client.setAuth(auth);
  convexClientCache.set(auth, env.NEXT_PUBLIC_CONVEX_URL, client);
  return client;
}

// Return a Convex client without auth (for public queries)
// Caches with a special "public" key
export function getPublicConvex() {
  const cacheKey = "__public__";
  const cachedClient = convexClientCache.get(cacheKey, env.NEXT_PUBLIC_CONVEX_URL);
  if (cachedClient) {
    return cachedClient;
  }

  const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
  convexClientCache.set(cacheKey, env.NEXT_PUBLIC_CONVEX_URL, client);
  return client;
}

// Return a Convex client for internal/system operations.
// Uses the same auth context as getConvex() if available, otherwise returns unauthenticated client.
// This is for internal endpoints where auth is handled externally (e.g., via CMUX_INTERNAL_SECRET).
export function getInternalConvex() {
  const auth = getAuthToken();
  if (auth) {
    // If auth context exists, use it
    const cachedClient = convexClientCache.get(auth, env.NEXT_PUBLIC_CONVEX_URL);
    if (cachedClient) {
      return cachedClient;
    }
    const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
    client.setAuth(auth);
    convexClientCache.set(auth, env.NEXT_PUBLIC_CONVEX_URL, client);
    return client;
  }

  // No auth context - return public client
  // This is for internal worker calls that don't have user auth
  return getPublicConvex();
}

export type { ConvexHttpClient };
