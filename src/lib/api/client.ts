import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
const ACCESS = "rivr.access";
const REFRESH = "rivr.refresh";

export async function setTokens(access: string, refresh?: string): Promise<void> {
  const pairs: [string, string][] = [[ACCESS, access]];
  if (refresh) pairs.push([REFRESH, refresh]);
  await AsyncStorage.multiSet(pairs);
}
export async function clearTokens(): Promise<void> {
  await AsyncStorage.multiRemove([ACCESS, REFRESH]);
}
export async function getAccessToken(): Promise<string | null> {
  return AsyncStorage.getItem(ACCESS);
}
export async function getRefreshToken(): Promise<string | null> {
  return AsyncStorage.getItem(REFRESH);
}

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
  const res = await fetch(`${BASE}/api/auth/token/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  await setTokens(data.access, data.refresh);
  return true;
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
  if (res.status === 401 && retry && (await tryRefresh())) {
    return request<T>(path, { ...opts, retry: false });
  }
  if (res.status === 401) {
    // Session is invalid and couldn't be refreshed: clear it and tell the app to
    // show Login, instead of surfacing a 401 error on whatever the user tapped.
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
  upload: <T = unknown>(p: string, form: FormData) => request<T>(p, { method: "POST", body: form, isForm: true }),
};
