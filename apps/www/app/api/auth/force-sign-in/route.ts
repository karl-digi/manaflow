import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

// Allowed hosts for redirect (prevents open redirect via x-forwarded-host)
const ALLOWED_HOSTS = new Set([
  "localhost",
]);

// Also allow *.karldigi.dev for dev tunnels
function isAllowedHost(host: string): boolean {
  if (ALLOWED_HOSTS.has(host)) return true;
  // Allow localhost with any port
  if (host.startsWith("localhost:")) return true;
  // Allow *.karldigi.dev for dev tunnels
  if (host.endsWith(".karldigi.dev")) return true;
  return false;
}

/**
 * Forces a fresh sign-in by clearing session cookies and redirecting to sign-in.
 * Used by the desktop app to ensure users see the account picker.
 *
 * NOTE: We manually clear cookies instead of using user.signOut() because
 * signOut() triggers its own redirect to afterSignOut (home page), which
 * would override our redirect to the sign-in page.
 */
export async function GET(request: Request) {
  // Build redirect URL considering proxy/tunnel headers
  // Priority: x-forwarded-* headers (from tunnel/proxy) > request URL (direct access)
  const headersList = await headers();
  const forwardedHost = headersList.get("x-forwarded-host");
  const forwardedProto = headersList.get("x-forwarded-proto");
  const requestUrl = new URL(request.url);

  let baseUrl: string;
  if (forwardedHost && isAllowedHost(forwardedHost)) {
    // Behind a proxy/tunnel - use forwarded headers (validated)
    const protocol = forwardedProto || "https";
    baseUrl = `${protocol}://${forwardedHost}`;
  } else {
    // Direct access or untrusted forwarded host - use request URL
    baseUrl = requestUrl.origin;
  }

  const response = NextResponse.redirect(new URL("/handler/sign-in", baseUrl));

  // Clear all Stack Auth cookies by setting them to expire immediately
  // This ensures the sign-in page shows the account picker instead of auto-signing in
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.includes("stack-")) {
      response.cookies.set(cookie.name, "", {
        expires: new Date(0),
        path: "/",
        // Both __Host- and __Secure- prefixed cookies require secure: true
        secure:
          cookie.name.startsWith("__Host-") ||
          cookie.name.startsWith("__Secure-"),
      });
    }
  }

  return response;
}
