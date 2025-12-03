import {
  convexClientCache,
  ConvexHttpClient,
} from "@cmux/shared/node/convex-cache";
import { env } from "./www-env";

export function getConvex({ accessToken }: { accessToken: string }) {
  // Try to get from cache first
  const cachedClient = convexClientCache.get(
    accessToken,
    env.NEXT_PUBLIC_CONVEX_URL
  );
  if (cachedClient) {
    return cachedClient;
  }

  // Create new client and cache it
  const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
  client.setAuth(accessToken);
  convexClientCache.set(accessToken, env.NEXT_PUBLIC_CONVEX_URL, client);
  return client;
}

const PUBLIC_CACHE_KEY = "__public__";

/**
 * Get a Convex client for unauthenticated (public) access.
 * Use this for public mutations like waitlist signups.
 */
export function getPublicConvex() {
  // Try to get from cache first
  const cachedClient = convexClientCache.get(
    PUBLIC_CACHE_KEY,
    env.NEXT_PUBLIC_CONVEX_URL
  );
  if (cachedClient) {
    return cachedClient;
  }

  // Create new client and cache it
  const client = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
  convexClientCache.set(PUBLIC_CACHE_KEY, env.NEXT_PUBLIC_CONVEX_URL, client);
  return client;
}
