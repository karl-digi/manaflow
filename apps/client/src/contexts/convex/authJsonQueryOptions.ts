import { cachedGetUser } from "@/lib/cachedGetUser";
import { stackClientApp } from "@/lib/stack";
import { queryOptions } from "@tanstack/react-query";
import { decodeJwt } from "jose";

export type AuthJson = { accessToken: string | null } | null;

export interface StackUserLike {
  getAuthJson: () => Promise<{ accessToken: string | null }>;
}

const defaultAuthJsonRefreshInterval = 4 * 60 * 1000;
const minimumRefreshInterval = 30 * 1000;
const expirySafetyWindow = 60 * 1000;

function getRefreshInterval(token?: string | null): number {
  if (!token) return defaultAuthJsonRefreshInterval;

  try {
    const payload = decodeJwt(token);
    if (!payload.exp) {
      return defaultAuthJsonRefreshInterval;
    }
    const expiresAt = payload.exp * 1000;
    const msUntilExpiry = expiresAt - Date.now();
    if (msUntilExpiry <= expirySafetyWindow) {
      return minimumRefreshInterval;
    }
    return Math.max(
      minimumRefreshInterval,
      msUntilExpiry - expirySafetyWindow
    );
  } catch (error) {
    console.warn("Failed to decode auth token for refresh interval", error);
    return defaultAuthJsonRefreshInterval;
  }
}

export function authJsonQueryOptions() {
  return queryOptions<AuthJson>({
    queryKey: ["authJson"],
    queryFn: async () => {
      const user = await cachedGetUser(stackClientApp);
      if (!user) return null;
      const authJson = await user.getAuthJson();
      return authJson ?? null;
    },
    refetchInterval: (query) =>
      getRefreshInterval(query.state.data?.accessToken ?? null),
    refetchIntervalInBackground: true,
  });
}
