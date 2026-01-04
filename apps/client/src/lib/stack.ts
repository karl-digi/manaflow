import { client as wwwOpenAPIClient } from "@cmux/www-openapi-client/client.gen";
import { StackClientApp } from "@stackframe/react";
import { useNavigate as useTanstackNavigate } from "@tanstack/react-router";
import { env } from "../client-env";
import { signalConvexAuthReady } from "../contexts/convex/convex-auth-ready";
import { convexQueryClient } from "../contexts/convex/convex-query-client";
import { cachedGetUser } from "./cachedGetUser";
import { WWW_ORIGIN } from "./wwwOrigin";

export const stackClientApp = new StackClientApp({
  projectId: env.NEXT_PUBLIC_STACK_PROJECT_ID,
  publishableClientKey: env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
  redirectMethod: {
    useNavigate() {
      const navigate = useTanstackNavigate();
      return (to: string) => {
        navigate({ to });
      };
    },
  },
});

convexQueryClient.convexClient.setAuth(
  stackClientApp.getConvexClientAuth({ tokenStore: "cookie" }),
  (isAuthenticated) => {
    signalConvexAuthReady(isAuthenticated);
  },
);

/**
 * Checks if a response indicates an expired/invalid auth token.
 */
function isTokenExpiredResponse(status: number, bodyText: string): boolean {
  if (status !== 401) return false;
  const lowerBody = bodyText.toLowerCase();
  return (
    lowerBody.includes("token expired") ||
    lowerBody.includes("invalid auth header") ||
    lowerBody.includes("jwt expired") ||
    lowerBody.includes("unauthorized")
  );
}

/**
 * Clears the cached user to force a fresh fetch with token refresh on next call.
 */
function clearCachedUser(): void {
  if (typeof window !== "undefined") {
    window.cachedUser = null;
    window.userPromise = null;
  }
}

const fetchWithAuth = (async (request: Request) => {
  const makeRequest = async (isRetry: boolean): Promise<Response> => {
    const user = await cachedGetUser(stackClientApp);
    if (!user) {
      throw new Error("User not found");
    }

    // getAuthHeaders() should return fresh headers - Stack Auth handles refresh internally
    const authHeaders = await user.getAuthHeaders();
    const mergedHeaders = new Headers();
    for (const [key, value] of Object.entries(authHeaders)) {
      mergedHeaders.set(key, value);
    }
    for (const [key, value] of request instanceof Request
      ? request.headers.entries()
      : []) {
      mergedHeaders.set(key, value);
    }

    // Clone the request for potential retry (request body can only be consumed once)
    const requestForFetch = isRetry ? request.clone() : request;

    const response = await fetch(requestForFetch, {
      headers: mergedHeaders,
    });

    return response;
  };

  // First attempt
  let response = await makeRequest(false);

  // Check if it's an auth error that warrants a retry
  if (response.status === 401) {
    const clone = response.clone();
    let bodyText = "";
    try {
      bodyText = await clone.text();
    } catch (e) {
      console.error("[APIError] Failed to read error body for retry check", e);
    }

    if (isTokenExpiredResponse(response.status, bodyText)) {
      console.warn(
        "[Auth] Token expired, clearing cache and retrying with fresh token..."
      );

      // Clear the cached user to force Stack Auth to refresh the token
      clearCachedUser();

      // Retry the request with fresh auth headers
      try {
        response = await makeRequest(true);
        if (response.ok) {
          console.log("[Auth] Retry succeeded with refreshed token");
        }
      } catch (retryError) {
        console.error("[Auth] Retry failed after token refresh:", retryError);
        // Return the original 401 response if retry fails
      }
    }
  }

  // Log non-OK responses for debugging
  if (!response.ok) {
    try {
      const clone = response.clone();
      const bodyText = await clone.text();
      console.error("[APIError]", {
        url: response.url,
        status: response.status,
        statusText: response.statusText,
        body: bodyText.slice(0, 2000),
      });
    } catch (e) {
      console.error("[APIError] Failed to read error body", e);
    }
  }

  return response;
}) as typeof fetch; // TODO: remove when bun types dont conflict with node types

wwwOpenAPIClient.setConfig({
  baseUrl: WWW_ORIGIN,
  fetch: fetchWithAuth,
});
