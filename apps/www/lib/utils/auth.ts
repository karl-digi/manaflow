import { stackServerAppJs } from "@/lib/utils/stack";

export async function getAccessTokenFromRequest(
  req: Request
): Promise<string | null> {
  // First, try to get user from Stack Auth's token store (cookies)
  try {
    const user = await stackServerAppJs.getUser({ tokenStore: req });
    if (user) {
      const { accessToken } = await user.getAuthJson();
      if (accessToken) return accessToken;
    }
  } catch (e) {
    // Fall through to try Bearer token
    console.error("[auth] cookie-based auth failed:", e);
  }

  // Fallback: Check for Bearer token in Authorization header (for CLI clients)
  // We validate the token by passing it to the Stack Auth SDK, which
  // performs cryptographic signature verification.
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7); // Remove "Bearer " prefix

    try {
      // Validate token by having Stack Auth SDK verify it
      const user = await stackServerAppJs.getUser({
        tokenStore: { accessToken: token, refreshToken: token },
      });
      if (user) {
        return token;
      }
    } catch (_e) {
      // Token validation failed
    }
  }

  // Fallback: Check for x-stack-auth header (from client's getAuthHeaders())
  const stackAuthHeader = req.headers.get("x-stack-auth");
  if (stackAuthHeader) {
    try {
      const parsed = JSON.parse(stackAuthHeader) as { accessToken?: string; refreshToken?: string };
      if (parsed.accessToken) {
        // Validate token by having Stack Auth SDK verify it
        const user = await stackServerAppJs.getUser({
          tokenStore: { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken || parsed.accessToken },
        });
        if (user) {
          return parsed.accessToken;
        }
        // User not found with this token - likely expired
        console.warn("[auth] x-stack-auth: getUser returned null (token may be expired)");
      }
    } catch (e) {
      // Token validation failed - log for debugging but return null to trigger 401
      const errMsg = e instanceof Error ? e.message : String(e);
      console.warn("[auth] x-stack-auth validation failed:", errMsg);
    }
  }

  return null;
}

/**
 * Get Stack Auth user from request, supporting both cookie-based (web) and
 * Bearer token (CLI) authentication.
 *
 * For CLI clients, we pass the access token directly to the Stack Auth SDK
 * which performs cryptographic signature verification.
 */
export async function getUserFromRequest(req: Request) {
  // First, try cookie-based auth (standard web flow)
  try {
    const user = await stackServerAppJs.getUser({ tokenStore: req });
    if (user) {
      return user;
    }
  } catch (_e) {
    // Fall through to try Bearer token
  }

  // Fallback: Check for Bearer token in Authorization header (for CLI clients)
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7); // Remove "Bearer " prefix

    try {
      // Pass the token to Stack Auth SDK for cryptographic verification
      const user = await stackServerAppJs.getUser({
        tokenStore: { accessToken: token, refreshToken: token },
      });
      if (user) {
        return user;
      }
    } catch (_e) {
      // Bearer token auth failed
    }
  }

  // Fallback: Check for x-stack-auth header (from client's getAuthHeaders())
  const stackAuthHeader = req.headers.get("x-stack-auth");
  if (stackAuthHeader) {
    try {
      const parsed = JSON.parse(stackAuthHeader) as { accessToken?: string; refreshToken?: string };
      if (parsed.accessToken) {
        // Validate token by having Stack Auth SDK verify it
        const user = await stackServerAppJs.getUser({
          tokenStore: { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken || parsed.accessToken },
        });
        if (user) {
          return user;
        }
        // User not found with this token - likely expired, client should refresh
        console.warn("[auth] x-stack-auth: getUser returned null (token may be expired)");
      }
    } catch (e) {
      // Token validation failed - log and return null to trigger 401
      // Client will receive 401 and handle token refresh
      const errMsg = e instanceof Error ? e.message : String(e);
      console.warn("[auth] x-stack-auth validation failed:", errMsg);
    }
  }

  return null;
}
