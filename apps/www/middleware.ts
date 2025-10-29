import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host");
  const { pathname } = request.nextUrl;

  // Handle heatmap subdomain - only rewrite the root path
  if (hostname?.startsWith("heatmap.") && pathname === "/") {
    return NextResponse.rewrite(new URL("/heatmap", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
