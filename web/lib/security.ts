/**
 * Web-side security utilities for RIVR Health.
 *
 * enforceHttps: validate API base URL at module init time.
 * validateUrlToken / validateUrlUid: validate tokens/UIDs from URL query
 *   params before submitting them to the backend.
 */

// base64url chars plus ':' and '.' — Django's signed email-verify token is
// "data:timestamp:signature" (contains colons); reset/share tokens use only
// base64url. Rejecting ':' here was silently failing every verification link.
const TOKEN_REGEX = /^[A-Za-z0-9_.:-]{20,500}$/;
// uid is urlsafe-base64 of the user's UUID pk (e.g. "ODI1ODZkZDYt..."), i.e.
// base64url chars — NOT a raw UUID or integer. The server does the real check
// (urlsafe_base64_decode + token validation); this is only a sanity pre-check.
const UID_REGEX = /^[A-Za-z0-9_-]+$/;

/** Throw if the API base URL is not HTTPS in production. */
export function enforceHttps(url: string, isDev: boolean): void {
  if (isDev) return; // Dev builds allow http://localhost
  if (
    !url.startsWith("https://") &&
    !url.startsWith("http://localhost") &&
    !url.startsWith("http://127.0.0.1")
  ) {
    throw new Error(
      `[WebApiClient] NEXT_PUBLIC_API_URL must use HTTPS in production; got: ${url}`,
    );
  }
}

/** Returns true if the value is a plausible reset/verify token (base64url, 20–500 chars). */
export function validateUrlToken(token: string | null | undefined): boolean {
  if (!token) return false;
  return TOKEN_REGEX.test(token);
}

/** Returns true if the value is a plausible base64url uid (server validates for real). */
export function validateUrlUid(uid: string | null | undefined): boolean {
  if (!uid) return false;
  if (uid.length < 1 || uid.length > 64) return false;
  return UID_REGEX.test(uid);
}
