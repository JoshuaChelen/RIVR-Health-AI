import { beforeEach, describe, expect, it, vi } from "vitest";

// __DEV__ is a React Native / Expo global — define it before any module import.
(globalThis as any).__DEV__ = true; // true = dev mode → HTTPS guard is off in tests

// ── Mock SecureStore ──────────────────────────────────────────────────────────
const secureStore: Record<string, string> = {};
vi.mock("expo-secure-store", () => ({
  getItemAsync:    vi.fn(async (k: string) => secureStore[k] ?? null),
  setItemAsync:    vi.fn(async (k: string, v: string) => { secureStore[k] = v; }),
  deleteItemAsync: vi.fn(async (k: string) => { delete secureStore[k]; }),
}));

// ── Mock AsyncStorage ─────────────────────────────────────────────────────────
const asyncStore: Record<string, string> = {};
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem:     vi.fn(async (k: string) => asyncStore[k] ?? null),
    setItem:     vi.fn(async (k: string, v: string) => { asyncStore[k] = v; }),
    multiSet:    vi.fn(async (pairs: [string, string][]) => { for (const [k, v] of pairs) asyncStore[k] = v; }),
    multiRemove: vi.fn(async (keys: string[]) => { for (const k of keys) delete asyncStore[k]; }),
    getAllKeys:   vi.fn(async () => Object.keys(asyncStore)),
    removeItem:  vi.fn(async (k: string) => { delete asyncStore[k]; }),
  },
}));

// ── Mock react-native Platform ────────────────────────────────────────────────
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

import { ApiError, api, setTokens, setUnauthorizedHandler } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("mobile api client", () => {
  beforeEach(() => {
    for (const k of Object.keys(secureStore)) delete secureStore[k];
    for (const k of Object.keys(asyncStore)) delete asyncStore[k];
    setUnauthorizedHandler(null);
  });

  it("attaches the Bearer access token", async () => {
    await setTokens("acc", "ref");
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await api.get("/api/auth/me");
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((call[1]?.headers as Record<string, string>).Authorization).toBe("Bearer acc");
  });

  it("refreshes on 401 then retries the original request", async () => {
    await setTokens("old", "ref");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ access: "new", refresh: "ref2" }))
      .mockResolvedValueOnce(jsonResponse({ email: "a@b.com" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await api.get<{ email: string }>("/api/auth/me");
    expect(res.email).toBe("a@b.com");
    expect(secureStore["rivr.access"]).toBe("new");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("clears the session and fires the unauthorized handler when a 401 can't be refreshed", async () => {
    await setTokens("acc"); // no refresh token → refresh can't succeed
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(api.get("/api/health-profile")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(secureStore["rivr.access"]).toBeUndefined();
  });

  it("throws ApiError with status + detail on failure", async () => {
    await setTokens("acc");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ detail: "nope" }, 400)));
    await expect(api.get("/x")).rejects.toMatchObject({ status: 400, message: "nope" });
    await expect(api.get("/x")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("HTTPS enforcement (module-load guard)", () => {
  it("module loads without error in dev mode (HTTPS guard bypassed by __DEV__=true)", () => {
    // In test environment __DEV__=true, so even an http:// URL passes.
    expect(api).toBeDefined();
  });
});
