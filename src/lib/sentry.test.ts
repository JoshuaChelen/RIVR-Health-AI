import { describe, expect, it, vi } from "vitest";
import type { ErrorEvent } from "@sentry/react-native";

// Mock @sentry/react-native so it doesn't try to load native modules.
vi.mock("@sentry/react-native", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  setUser: vi.fn(),
}));

// __DEV__ is a React Native global; define it before importing sentry.ts.
(globalThis as any).__DEV__ = false;

import { scrubPii } from "./sentry";

function makeEvent(overrides: Partial<ErrorEvent>): ErrorEvent {
  return { type: undefined, ...overrides } as ErrorEvent;
}

describe("Sentry PII scrubbing — scrubPii()", () => {
  it("redacts email query params from request URLs", () => {
    const event = makeEvent({
      request: { url: "https://api.rivr.com/api/auth/me?email=user@example.com&next=/" },
    });
    const out = scrubPii(event)!;
    expect(out.request?.url).toMatch(/email=REDACTED/);
    expect(out.request?.url).not.toMatch(/user@example\.com/);
    expect(out.request?.url).toMatch(/next=\//);
  });

  it("redacts Bearer tokens from Authorization header", () => {
    const event = makeEvent({
      request: { headers: { Authorization: "Bearer abc123xyz456" } },
    });
    const out = scrubPii(event)!;
    expect((out.request?.headers as Record<string, string>)?.Authorization).toBe(
      "Bearer REDACTED",
    );
  });

  it("redacts non-Bearer auth headers completely", () => {
    const event = makeEvent({
      request: { headers: { "x-api-key": "super-secret-key" } },
    });
    const out = scrubPii(event)!;
    expect((out.request?.headers as Record<string, string>)?.["x-api-key"]).toBe("REDACTED");
  });

  it("removes email from the Sentry user context but preserves id", () => {
    const event = makeEvent({
      user: { id: "user-123", email: "user@example.com" },
    });
    const out = scrubPii(event)!;
    expect(out.user?.email).toBeUndefined();
    expect(out.user?.id).toBe("user-123");
  });

  it("drops breadcrumbs that mention health-related terms", () => {
    const event = makeEvent({
      breadcrumbs: [
        { category: "health", message: "Fetched health summary", data: {} },
        { category: "network", message: "GET /api/users", data: {} },
        { category: "ui.click", message: "blood pressure panel opened", data: {} },
        { category: "console", message: "User navigation", data: {} },
      ],
    });
    const out = scrubPii(event)!;
    expect(out.breadcrumbs).toHaveLength(2);
    expect(out.breadcrumbs?.map((b) => b.category)).toEqual(["network", "console"]);
  });

  it("returns null for falsy input", () => {
    expect(scrubPii(null as any)).toBeNull();
  });

  it("handles events with no request or breadcrumbs fields gracefully", () => {
    const event = makeEvent({});
    expect(() => scrubPii(event)).not.toThrow();
  });
});
