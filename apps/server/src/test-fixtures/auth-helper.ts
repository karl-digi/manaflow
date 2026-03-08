/**
 * Test Authentication Helper
 *
 * Provides authenticated test requests for HTTP API integration tests.
 * Reuses the Stack Auth pattern from cmux_http.integration.test.ts.
 *
 * Required environment variables:
 * - NEXT_PUBLIC_STACK_PROJECT_ID: Stack Auth project ID
 * - NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: Stack Auth publishable key
 * - STACK_SECRET_SERVER_KEY: Stack Auth secret key
 * - STACK_SUPER_SECRET_ADMIN_KEY: Stack Auth admin key
 * - STACK_TEST_USER_ID (optional): User ID for testing (defaults to test user)
 * - CMUX_TEST_TEAM_SLUG (optional): Team slug for testing (defaults to "dev")
 */

import { StackAdminApp } from "@stackframe/js";

// Test configuration
export const TEST_USER_ID =
  process.env.STACK_TEST_USER_ID ?? "487b5ddc-0da0-4f12-8834-f452863a83f5";
export const TEST_TEAM = process.env.CMUX_TEST_TEAM_SLUG ?? "dev";

// Stack Auth admin app singleton
let stackAdminApp: StackAdminApp | null = null;

/**
 * Check if Stack Auth credentials are configured
 */
export function hasAuthCredentials(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_STACK_PROJECT_ID &&
    process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY &&
    process.env.STACK_SECRET_SERVER_KEY &&
    process.env.STACK_SUPER_SECRET_ADMIN_KEY
  );
}

/**
 * Get or create Stack Admin app singleton
 */
function getStackAdmin(): StackAdminApp {
  if (!stackAdminApp) {
    const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
    const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;
    const secretKey = process.env.STACK_SECRET_SERVER_KEY;
    const adminKey = process.env.STACK_SUPER_SECRET_ADMIN_KEY;

    if (!projectId || !publishableKey || !secretKey || !adminKey) {
      throw new Error("Stack Auth credentials not configured for testing");
    }

    stackAdminApp = new StackAdminApp({
      projectId,
      publishableClientKey: publishableKey,
      secretServerKey: secretKey,
      superSecretAdminKey: adminKey,
      tokenStore: "memory",
    });
  }
  return stackAdminApp;
}

/**
 * Get test authentication tokens for a user
 *
 * Creates a short-lived session for the test user and returns access tokens.
 *
 * @returns Promise with accessToken and optional refreshToken
 */
export async function getTestAuthTokens(): Promise<{
  accessToken: string;
  refreshToken?: string;
}> {
  const admin = getStackAdmin();
  const user = await admin.getUser(TEST_USER_ID);
  if (!user) {
    throw new Error(`Test user ${TEST_USER_ID} not found`);
  }

  const session = await user.createSession({ expiresInMillis: 5 * 60 * 1000 });
  const tokens = await session.getTokens();

  if (!tokens.accessToken) {
    throw new Error("No access token returned from session");
  }

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? undefined,
  };
}

/**
 * Helper type for API responses
 */
export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

/**
 * Make an authenticated fetch request
 *
 * Automatically handles auth token injection and JSON parsing.
 *
 * @param url - Full URL to fetch
 * @param options - Fetch options (method, body, etc.)
 * @returns ApiResponse with parsed data or error
 */
export async function authenticatedFetch<T>(
  url: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {}
): Promise<ApiResponse<T>> {
  const tokens = await getTestAuthTokens();

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokens.accessToken}`,
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: data?.error ?? data?.message ?? `HTTP ${response.status}`,
    };
  }

  return {
    ok: true,
    status: response.status,
    data: data as T,
  };
}

/**
 * Build URL with query parameters
 */
export function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string>
): string {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}
