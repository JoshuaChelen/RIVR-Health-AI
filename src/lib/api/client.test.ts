import { beforeEach, describe, expect, it, vi } from "vitest";

const store: Record<string, string> = {};

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => store[k] ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store[k] = v; }),
    multiSet: vi.fn(async (pairs: [string, string][]) => { for (const [k, v] of pairs) store[k] = v; }),
    multiRemove: vi.fn(async (keys: string[]) => { for (const k of keys) delete store[k]; }),
  },
}));

import { ApiError, api, setTokens } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("mobile api client", () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
  });

  it("attaches the Bearer access token", async () => {
    await setTokens("acc", "ref");
    const fetchMock = vi.fn(async (_url: string, _opts?: RequestInit) => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await api.get("/api/auth/me");
    const opts = fetchMock.mock.calls[0][1];
    expect((opts?.headers as Record<string, string>).Authorization).toBe("Bearer acc");
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
    expect(store["rivr.access"]).toBe("new");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws ApiError with status + detail on failure", async () => {
    await setTokens("acc");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ detail: "nope" }, 400)));
    await expect(api.get("/x")).rejects.toMatchObject({ status: 400, message: "nope" });
    await expect(api.get("/x")).rejects.toBeInstanceOf(ApiError);
  });
});
