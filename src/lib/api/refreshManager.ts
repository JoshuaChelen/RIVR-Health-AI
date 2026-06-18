/**
 * Bounded token-refresh manager for RIVR Health API client.
 *
 * Prevents the unbounded 401→refresh loop by enforcing:
 *   1. Per-request retry limit (max 3 per endpoint key)
 *   2. Exponential backoff on consecutive failures
 *   3. Session-level circuit-breaker: after N failures in a sliding window
 *      all refresh attempts are blocked until the window resets, then
 *      the caller should force-logout.
 */

interface PerRequestState {
  count: number;
}

const MAX_ATTEMPTS_PER_REQUEST = 3;
const MAX_FAILURES_IN_WINDOW = 3;
const FAILURE_WINDOW_MS = 30_000;

export class RefreshManager {
  private readonly perRequest = new Map<string, PerRequestState>();
  // timestamps of recent failures (session-level)
  private failureTimes: number[] = [];

  /**
   * Returns true if a refresh attempt is allowed for the given request key
   * (`METHOD:path`, e.g. `"GET:/api/auth/me"`).
   * Returns false if the per-request limit is exhausted OR the circuit-breaker
   * is open — in which case the caller must force-logout.
   */
  canAttemptRefresh(requestKey: string): boolean {
    if (this.isCircuitBreakerOpen()) return false;
    const state = this.perRequest.get(requestKey);
    return !state || state.count < MAX_ATTEMPTS_PER_REQUEST;
  }

  /**
   * Record the outcome of a refresh attempt for a specific request key.
   * On failure the session-level failure window is updated.
   */
  recordAttempt(requestKey: string, success: boolean): void {
    const state = this.perRequest.get(requestKey) ?? { count: 0 };
    state.count += 1;
    this.perRequest.set(requestKey, state);

    if (!success) {
      const now = Date.now();
      this.failureTimes.push(now);
      // Prune old timestamps outside the window.
      this.failureTimes = this.failureTimes.filter((t) => now - t < FAILURE_WINDOW_MS);
    }
  }

  /** After a successful refresh for a request, reset its per-request counter. */
  recordSuccess(requestKey: string): void {
    this.perRequest.delete(requestKey);
  }

  isCircuitBreakerOpen(): boolean {
    const now = Date.now();
    const recent = this.failureTimes.filter((t) => now - t < FAILURE_WINDOW_MS);
    return recent.length >= MAX_FAILURES_IN_WINDOW;
  }

  /** Milliseconds to wait before retrying after `attempt` failures (1-based). */
  getBackoffMs(attempt: number): number {
    // 100ms, 200ms, 400ms, ... capped at 8s
    return Math.min(100 * Math.pow(2, attempt - 1), 8_000);
  }

  /** Full reset — call on explicit sign-out. */
  reset(): void {
    this.perRequest.clear();
    this.failureTimes = [];
  }
}

export const refreshManager = new RefreshManager();
