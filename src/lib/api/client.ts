import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  initTokenStorage,
  setTokens,
} from "./tokenStorage";
import { refreshManager } from "./refreshManager";

// Re-export so callers that import from "./client" still get the token helpers.
export { clearTokens, getAccessToken, getRefreshToken, setTokens };

// ── HTTPS guard ───────────────────────────────────────────────────────────────
// Validate the API base URL at module load time.  In production we must use
// HTTPS; http://localhost is allowed for local dev only.
// __DEV__ is a Metro/Expo global — guard typeof for test environments (vitest).
const BASE = (() => {
  const url = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
  const isLocalhost =
    url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1");
  const isDev =
    typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";
  if (!isDev && !url.startsWith("https://") && !isLocalhost) {
    // This will surface as a startup crash in production — intentional.
    throw new Error(
      `[ApiClient] EXPO_PUBLIC_API_URL must use HTTPS in production builds; got: ${url}`,
    );
  }
  return url;
})();

// Kick off the one-time migration from AsyncStorage → SecureStore (native).
// Failures are non-fatal; they only mean the user might need to re-login once.
initTokenStorage().catch((e) =>
  console.warn("[ApiClient] Token storage init failed:", e),
);

// Called when a request is unauthorized and the session can't be refreshed.
// SessionContext registers this to drop the user, sending the app to Login.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, data: unknown) {
    super(ApiError.messageFrom(status, data));
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }

  // Surface the actual server message. DRF returns {detail: "..."} for generic
  // errors and {field: ["msg", ...]} (or {field: "msg"}) for validation errors
  // like registration — show the first concrete message instead of a bare code.
  private static messageFrom(status: number, data: unknown): string {
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (typeof d.detail === "string") return d.detail;
      for (const v of Object.values(d)) {
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
        if (typeof v === "string") return v;
      }
    }
    return `Request failed (${status})`;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function tryRefresh(): Promise<boolean> {
  const refresh = await getRefreshToken();
  if (!refresh) return false;
  try {
    const res = await fetch(`${BASE}/api/auth/token/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    await setTokens(data.access, data.refresh ?? refresh);
    return true;
  } catch {
    return false;
  }
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  isForm?: boolean;
  retry?: boolean;
}

export async function request<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = "GET", body, isForm = false, retry = true } = opts;
  const headers: Record<string, string> = {};
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (isForm) {
    payload = body as BodyInit;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });

  if (res.status === 401 && retry) {
    const requestKey = `${method}:${path}`;

    if (!refreshManager.canAttemptRefresh(requestKey)) {
      // Circuit-breaker open or per-request limit exhausted — force logout.
      await clearTokens();
      refreshManager.reset();
      onUnauthorized?.();
      const text = await res.text();
      const data = text ? safeJson(text) : null;
      throw new ApiError(res.status, data);
    }

    const refreshSucceeded = await tryRefresh();
    refreshManager.recordAttempt(requestKey, refreshSucceeded);

    if (refreshSucceeded) {
      refreshManager.recordSuccess(requestKey);
      return request<T>(path, { ...opts, retry: false });
    }

    // Refresh failed — apply backoff then check circuit-breaker again.
    const attempt = refreshManager.getAttemptCount(requestKey) || 1;
    const delayMs = refreshManager.getBackoffMs(attempt);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    if (refreshManager.isCircuitBreakerOpen()) {
      // Circuit-breaker tripped — force logout once and bail out so the generic
      // 401 block below doesn't fire onUnauthorized a second time.
      await clearTokens();
      refreshManager.reset();
      onUnauthorized?.();
      const text = await res.text();
      const data = text ? safeJson(text) : null;
      throw new ApiError(res.status, data);
    }
  }

  if (res.status === 401) {
    // Session is invalid and couldn't be refreshed: clear it and tell the app
    // to show Login instead of surfacing a 401 error on whatever the user tapped.
    await clearTokens();
    onUnauthorized?.();
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  get: <T = unknown>(p: string) => request<T>(p),
  post: <T = unknown>(p: string, b?: unknown) => request<T>(p, { method: "POST", body: b }),
  patch: <T = unknown>(p: string, b?: unknown) => request<T>(p, { method: "PATCH", body: b }),
  put: <T = unknown>(p: string, b?: unknown) => request<T>(p, { method: "PUT", body: b }),
  del: <T = unknown>(p: string) => request<T>(p, { method: "DELETE" }),
  upload: <T = unknown>(p: string, form: FormData) =>
    request<T>(p, { method: "POST", body: form, isForm: true }),
};
