/**
 * Web-side security utilities for RIVR Health.
 *
 * enforceHttps: validate API base URL at module init time.
 * validateUrlToken / validateUrlUid: validate tokens/UIDs from URL query
 *   params before submitting them to the backend.
 */

const TOKEN_REGEX = /^[A-Za-z0-9_-]{20,500}$/;
const UID_NUMERIC_REGEX = /^\d+$/;
const UID_UUID_REGEX = /^[0-9a-f-]{1,36}$/i;

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

/** Returns true if the value looks like a numeric user ID or UUID. */
export function validateUrlUid(uid: string | null | undefined): boolean {
  if (!uid) return false;
  if (uid.length === 0 || uid.length >= 100) return false;
  return UID_NUMERIC_REGEX.test(uid) || UID_UUID_REGEX.test(uid);
}
