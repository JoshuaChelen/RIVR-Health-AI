/**
 * Deep-link token and UID format validation.
 *
 * Validates tokens/UIDs at the parse layer (before navigation) to reject
 * malformed, injected, or otherwise suspicious values that arrive via
 * rivrhealth:// deep links.
 *
 * Token format:  base64url characters [A-Za-z0-9_-], length 20–500.
 * UID format:    numeric string (\d+) OR UUID (hex + hyphens), max 100 chars.
 *
 * Any input containing HTML-significant chars, whitespace, quotes, or
 * path-traversal patterns is rejected regardless of type.
 */

const TOKEN_REGEX = /^[A-Za-z0-9_-]{20,500}$/;
const UID_NUMERIC_REGEX = /^\d+$/;
const UID_UUID_REGEX = /^[0-9a-f-]{1,36}$/i;

const INJECTION_PATTERNS = [
  /<[^>]*>/, // HTML tags
  /['"`;]/, // Quotes, backtick, semicolon
  /\\/, // Backslashes
  /[\r\n\t]/, // Control whitespace
  /\s/, // Any whitespace
  // eslint-disable-next-line no-control-regex
  /\x00/, // Null byte
  /\.\.[/\\]/, // Path traversal
  /__proto__|prototype|constructor/i, // Prototype pollution
];

/** Returns true if the value is free of known injection characters. */
function isSafeInput(value: string): boolean {
  return !INJECTION_PATTERNS.some((re) => re.test(value));
}

/**
 * Validate a token or UID string.
 *
 * @param value  The raw string from a deep-link or URL parameter.
 * @param type   `"token"` (default) — password-reset token; `"uid"` — user ID.
 */
export function validateTokenFormat(
  value: unknown,
  type: "token" | "uid" = "token",
): boolean {
  if (!value || typeof value !== "string") return false;
  if (!isSafeInput(value)) return false;

  if (type === "uid") {
    if (value.length === 0 || value.length >= 100) return false;
    return UID_NUMERIC_REGEX.test(value) || UID_UUID_REGEX.test(value);
  }

  // type === "token"
  return TOKEN_REGEX.test(value);
}

/**
 * Returns true only when both uid and token pass their respective format
 * checks.  Used by UpdatePasswordScreen to guard the form and the API call.
 */
export function isValidResetToken(
  uid: string | null | undefined,
  token: string | null | undefined,
): boolean {
  return (
    !!uid &&
    !!token &&
    validateTokenFormat(uid, "uid") &&
    validateTokenFormat(token, "token")
  );
}
