import type { SocketAuth } from "@cmux/shared";
import { cachedGetUser } from "../../lib/cachedGetUser";
import { stackClientApp } from "../../lib/stack";

/**
 * Gets fresh auth tokens for Socket.IO messages.
 * This ensures tokens are always up-to-date, even if the initial connection token expired.
 */
export async function getSocketAuth(): Promise<SocketAuth> {
  const user = await cachedGetUser(stackClientApp);

  if (!user) {
    throw new Error("User not authenticated");
  }

  const authHeaders = await user.getAuthHeaders();
  const accessToken = authHeaders["x-stack-auth"];

  if (!accessToken) {
    throw new Error("Failed to get access token from user.getAuthHeaders()");
  }

  // Also get the full auth JSON for server-side use
  const authJson = await user.getAuthJson();

  return {
    authToken: accessToken,
    authJson: authJson ? JSON.stringify(authJson) : undefined,
  };
}

/**
 * Attaches fresh auth tokens to a Socket.IO event payload.
 * Usage: socket.emit("event-name", await withSocketAuth({ ...data }), callback)
 */
export async function withSocketAuth<T extends Record<string, unknown>>(
  data: T
): Promise<T & { auth: SocketAuth }> {
  const auth = await getSocketAuth();
  return { ...data, auth };
}
