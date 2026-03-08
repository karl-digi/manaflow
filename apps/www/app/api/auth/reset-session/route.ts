import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Clears all Stack Auth session cookies and redirects to a given URL.
 *
 * This breaks the redirect loop that occurs when a user has stale session
 * cookies: Stack Auth thinks they're signed in (so /handler/sign-in auto-
 * bounces back) but the tokens are broken (so the page can't get an access
 * token and redirects to sign-in again).
 *
 * By clearing cookies first, the sign-in page actually renders the login UI
 * instead of auto-redirecting.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("returnTo");

  if (!returnTo || !returnTo.startsWith("/")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const cookieStore = await cookies();
  const response = NextResponse.redirect(new URL(returnTo, request.url));

  // Delete all Stack Auth cookies by setting them to expire immediately
  // We must set the cookies on the response to ensure they're actually cleared
  // Note: __Host- prefixed cookies require secure: true to be modified
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
