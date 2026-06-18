/**
 * Next.js middleware: inject security headers on token-carrying routes.
 *
 * Referrer-Policy: no-referrer on auth and share routes prevents the browser
 * from including a Referer header when the user navigates away from a page
 * whose URL contains a reset/verify/share token, stopping that token from
 * leaking to third-party analytics or CDN servers.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest): NextResponse {
  const response = NextResponse.next();
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export const config = {
  // Apply to all auth routes and the share page.
  matcher: ["/auth/:path*", "/share/:path*", "/share"],
};
