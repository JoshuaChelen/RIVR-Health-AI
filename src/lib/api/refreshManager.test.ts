import { beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshManager } from "./refreshManager";

describe("RefreshManager", () => {
  let mgr: RefreshManager;

  beforeEach(() => {
    mgr = new RefreshManager();
    vi.useRealTimers();
  });

  it("allows attempts up to the per-request limit (3)", () => {
    const key = "GET:/api/data";
    expect(mgr.canAttemptRefresh(key)).toBe(true);
    mgr.recordAttempt(key, false);
    expect(mgr.canAttemptRefresh(key)).toBe(true);
    mgr.recordAttempt(key, false);
    expect(mgr.canAttemptRefresh(key)).toBe(true);
    mgr.recordAttempt(key, false);
    // after 3 failures the per-request limit is reached
    expect(mgr.canAttemptRefresh(key)).toBe(false);
  });

  it("resets per-request counter after a successful refresh", () => {
    const key = "GET:/api/data";
    mgr.recordAttempt(key, false);
    mgr.recordAttempt(key, false);
    expect(mgr.canAttemptRefresh(key)).toBe(true); // 2 < 3
    mgr.recordSuccess(key);
    // counter cleared — full budget available again
    expect(mgr.canAttemptRefresh(key)).toBe(true);
  });

  it("getAttemptCount returns the recorded count for a request key (0 if none)", () => {
    const key = "GET:/api/data";
    expect(mgr.getAttemptCount(key)).toBe(0);
    mgr.recordAttempt(key, false);
    expect(mgr.getAttemptCount(key)).toBe(1);
    mgr.recordAttempt(key, false);
    expect(mgr.getAttemptCount(key)).toBe(2);
    mgr.recordSuccess(key);
    expect(mgr.getAttemptCount(key)).toBe(0);
  });

  it("implements exponential backoff (100ms × 2^(n-1), capped at 8s)", () => {
    expect(mgr.getBackoffMs(1)).toBe(100);
    expect(mgr.getBackoffMs(2)).toBe(200);
    expect(mgr.getBackoffMs(3)).toBe(400);
    expect(mgr.getBackoffMs(7)).toBe(6400);
    expect(mgr.getBackoffMs(10)).toBe(8000); // capped
  });

  it("opens circuit-breaker after 3 failures within 30 s window", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    mgr.recordAttempt("GET:/a", false);
    mgr.recordAttempt("GET:/b", false);
    mgr.recordAttempt("GET:/c", false);

    expect(mgr.isCircuitBreakerOpen()).toBe(true);
    expect(mgr.canAttemptRefresh("GET:/d")).toBe(false);
  });

  it("circuit-breaker resets after the 30 s window expires", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    mgr.recordAttempt("GET:/a", false);
    mgr.recordAttempt("GET:/b", false);
    mgr.recordAttempt("GET:/c", false);

    expect(mgr.isCircuitBreakerOpen()).toBe(true);

    // advance past the 30 s window
    vi.setSystemTime(now + 31_000);
    expect(mgr.isCircuitBreakerOpen()).toBe(false);
    expect(mgr.canAttemptRefresh("GET:/d")).toBe(true);
  });

  it("reset() clears all state", () => {
    mgr.recordAttempt("GET:/a", false);
    mgr.recordAttempt("GET:/b", false);
    mgr.recordAttempt("GET:/c", false);
    expect(mgr.isCircuitBreakerOpen()).toBe(true);

    mgr.reset();

    expect(mgr.isCircuitBreakerOpen()).toBe(false);
    expect(mgr.canAttemptRefresh("GET:/a")).toBe(true);
  });
});
