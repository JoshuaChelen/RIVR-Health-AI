import { describe, expect, it, vi } from "vitest";

// next/server pulls in Next runtime internals; stub the bits the middleware uses.
vi.mock("next/server", () => {
  class FakeResponse {
    headers = new Map<string, string>();
  }
  return {
    NextResponse: {
      next: () => new FakeResponse(),
    },
  };
});

import { config, middleware } from "./middleware";

describe("web middleware — Referrer-Policy", () => {
  it("sets Referrer-Policy: no-referrer on the response", () => {
    const res = middleware() as unknown as { headers: Map<string, string> };
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("matches the REAL token-bearing routes (not the (auth) route group)", () => {
    // (auth) is a Next.js route group, so the live URLs are /reset-password and
    // /verify-email — there is NO /auth URL segment. Guard against regressing
    // back to the broken "/auth/:path*" matcher.
    expect(config.matcher).toContain("/reset-password");
    expect(config.matcher).toContain("/verify-email");
    expect(config.matcher).toContain("/share");
    expect(config.matcher).not.toContain("/auth/:path*");
    // None of the matchers should reference the (auth) group segment.
    for (const m of config.matcher) {
      expect(m.startsWith("/auth")).toBe(false);
    }
  });
});
