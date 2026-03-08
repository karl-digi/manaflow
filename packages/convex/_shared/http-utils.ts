/**
 * Shared HTTP utilities for Convex httpAction handlers.
 */

/**
 * Create a JSON response with the given body and status code.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

/**
 * Extract a bearer token from an Authorization header.
 * Returns null if the header is missing, empty, or malformed.
 */
export function extractBearerToken(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const token = match[1]?.trim();
  return token && token.length > 0 ? token : null;
}
