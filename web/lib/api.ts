const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

class ApiError extends Error {
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

interface Opts {
  method?: string;
  body?: unknown;
  isForm?: boolean;
}

async function request<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const { method = "GET", body, isForm = false } = opts;
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (isForm) payload = body as FormData;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  post: <T = any>(p: string, b?: unknown) => request<T>(p, { method: "POST", body: b }),
};

export const apiBase = BASE;
