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

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, data: unknown) {
    const detail =
      data && typeof data === "object" && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : `Request failed (${status})`;
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
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

export const apiBaseUrl = BASE;
