const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ACCESS = "rivr.access";
const REFRESH = "rivr.refresh";

export function getAccess(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem(ACCESS) : null;
}
export function getRefresh(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem(REFRESH) : null;
}
export function setTokens(access: string, refresh?: string): void {
  localStorage.setItem(ACCESS, access);
  if (refresh) localStorage.setItem(REFRESH, refresh);
}
export function clearTokens(): void {
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, data: unknown) {
    super(typeof data === "object" && data && "detail" in data ? String((data as any).detail) : `Request failed (${status})`);
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
  const refresh = getRefresh();
  if (!refresh) return false;
  const res = await fetch(`${BASE}/api/auth/token/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  setTokens(data.access, data.refresh);
  return true;
}

interface Opts {
  method?: string;
  body?: unknown;
  isForm?: boolean;
  retry?: boolean;
}

async function request<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const { method = "GET", body, isForm = false, retry = true } = opts;
  const headers: Record<string, string> = {};
  const access = getAccess();
  if (access) headers["Authorization"] = `Bearer ${access}`;
  let payload: BodyInit | undefined;
  if (isForm) payload = body as FormData;
  else if (body !== undefined) {
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
  get: <T = any>(p: string) => request<T>(p),
  post: <T = any>(p: string, b?: unknown) => request<T>(p, { method: "POST", body: b }),
  patch: <T = any>(p: string, b?: unknown) => request<T>(p, { method: "PATCH", body: b }),
  put: <T = any>(p: string, b?: unknown) => request<T>(p, { method: "PUT", body: b }),
  del: <T = any>(p: string) => request<T>(p, { method: "DELETE" }),
  upload: <T = any>(p: string, form: FormData) => request<T>(p, { method: "POST", body: form, isForm: true }),
};

export const apiBase = BASE;
