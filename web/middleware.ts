/**
 * Next.js middleware: inject security headers on token-carrying routes.
 *
 * Referrer-Policy: no-referrer on the reset/verify/share routes prevents the
 * browser from including a Referer header when the user navigates away from a
 * page whose URL contains a reset/verify/share token, stopping that token from
 * leaking to third-party analytics or CDN servers.
 */

import { NextResponse } from "next/server";

export function middleware(): NextResponse {
  const response = NextResponse.next();
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export const config = {
  // Apply to the REAL token-bearing routes. NOTE: `(auth)` is a Next.js route
  // group, so the pages live at /reset-password and /verify-email — NOT under a
  // /auth URL segment. The backend emails link to exactly these paths
  // (see backend/apps/accounts/emails.py) and shares link to /share.
  matcher: ["/reset-password", "/verify-email", "/share", "/share/:path*"],
};
