import * as Sentry from "@sentry/react-native";
import type { ErrorEvent } from "@sentry/react-native";

// ── PII scrubbing ─────────────────────────────────────────────────────────────

// Category/message fragments that indicate a breadcrumb contains health data.
const HEALTH_BREADCRUMB_PATTERNS =
  /health|vital|blood|pressure|heart.?rate|weight|medication|symptom|diagnos|treatment|medical/i;

/**
 * Scrub PII from a Sentry event before it leaves the device.
 *
 * Redactions:
 *   - Email addresses in request URLs (e.g. ?email=user@example.com)
 *   - Authorization / token headers (Bearer tokens, API keys)
 *   - User email in the Sentry user context
 *   - Breadcrumbs whose category or message touches health-related keywords
 *
 * This is deliberately conservative: we'd rather drop a breadcrumb than leak
 * PHI to a third-party error-tracking service.
 */
// Exported for testing only — not part of the public API.
export function scrubPii(event: ErrorEvent): ErrorEvent | null {
  if (!event) return null;

  // 1. Redact email query params from request URLs.
  if (event.request?.url) {
    event.request.url = event.request.url
      .replace(/([?&])email=[^&]*/gi, "$1email=REDACTED")
      .replace(
        /([?&][a-zA-Z0-9_%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
        (_m, _g1) => "REDACTED",
      );
  }

  // 2. Redact Authorization header and any other token-bearing headers.
  if (event.request?.headers) {
    const headers = event.request.headers as Record<string, string>;
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower === "authorization" || lower.includes("token") || lower.includes("x-api-key")) {
        const val = headers[key];
        if (typeof val === "string") {
          headers[key] = val.startsWith("Bearer ")
            ? "Bearer REDACTED"
            : "REDACTED";
        }
      }
    }
  }

  // 3. Remove user email (keep user ID for support correlation).
  if (event.user?.email) {
    delete event.user.email;
  }

  // 4. Drop breadcrumbs that touch health data or health-related API paths.
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = (event.breadcrumbs as Sentry.Breadcrumb[]).filter(
      (bc) => {
        const cat = bc.category ?? "";
        const msg = bc.message ?? "";
        const url = (bc.data as { url?: string } | undefined)?.url ?? "";
        return (
          !HEALTH_BREADCRUMB_PATTERNS.test(cat) &&
          !HEALTH_BREADCRUMB_PATTERNS.test(msg) &&
          !HEALTH_BREADCRUMB_PATTERNS.test(url)
        );
      },
    );
  }

  return event;
}

// ── Sentry init ───────────────────────────────────────────────────────────────

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN || "";
const _isDev =
  typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";
if (dsn) {
  Sentry.init({
    dsn,
    enabled: !_isDev,
    tracesSampleRate: 0.2,
    environment: _isDev ? "development" : "production",
    beforeSend: (event: ErrorEvent) => scrubPii(event),
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function captureException(error: unknown): void {
  Sentry.captureException(error);
}

export function captureMessage(
  message: string,
  level?: "fatal" | "error" | "warning" | "log" | "debug" | "info",
): void {
  Sentry.captureMessage(message, level);
}

export function setUser(user: { id: string; email?: string } | null): void {
  if (user) {
    // Deliberately omit email — tracked by ID only.
    Sentry.setUser({ id: user.id });
  } else {
    Sentry.setUser(null);
  }
}

export { Sentry };
