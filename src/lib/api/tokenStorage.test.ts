import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const secureStore: Record<string, string> = {};
vi.mock("expo-secure-store", () => ({
  getItemAsync:    vi.fn(async (k: string) => secureStore[k] ?? null),
  setItemAsync:    vi.fn(async (k: string, v: string) => { secureStore[k] = v; }),
  deleteItemAsync: vi.fn(async (k: string) => { delete secureStore[k]; }),
}));

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

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import * as SecureStore from "expo-secure-store";
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  initTokenStorage,
  setTokens,
} from "./tokenStorage";

const setItemAsyncMock = vi.mocked(SecureStore.setItemAsync);

beforeEach(() => {
  for (const k of Object.keys(secureStore)) delete secureStore[k];
  for (const k of Object.keys(asyncStore)) delete asyncStore[k];
  // Reset the SecureStore write mock to its default (succeeding) behaviour so a
  // mockRejectedValueOnce from a previous test doesn't leak.
  setItemAsyncMock.mockReset();
  setItemAsyncMock.mockImplementation(async (k: string, v: string) => { secureStore[k] = v; });
});

describe("tokenStorage (native)", () => {
  it("stores and retrieves access + refresh tokens via SecureStore", async () => {
    await setTokens("acc123", "ref456");
    expect(await getAccessToken()).toBe("acc123");
    expect(await getRefreshToken()).toBe("ref456");
    // must NOT be in AsyncStorage (plaintext)
    expect(asyncStore["rivr.access"]).toBeUndefined();
  });

  it("clearTokens removes tokens from SecureStore", async () => {
    await setTokens("acc", "ref");
    await clearTokens();
    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
  });

  it("initTokenStorage migrates old AsyncStorage tokens to SecureStore on first run", async () => {
    // Simulate pre-migration state: tokens in AsyncStorage, no migration flag.
    asyncStore["rivr.access"] = "old_access";
    asyncStore["rivr.refresh"] = "old_refresh";

    await initTokenStorage();

    // Tokens should now be in SecureStore.
    expect(secureStore["rivr.access"]).toBe("old_access");
    expect(secureStore["rivr.refresh"]).toBe("old_refresh");
    // Old AsyncStorage entries should be gone.
    expect(asyncStore["rivr.access"]).toBeUndefined();
    expect(asyncStore["rivr.refresh"]).toBeUndefined();
    // Migration flag should be set.
    expect(asyncStore["rivr.storage_migrated_v1"]).toBe("1");
  });

  it("initTokenStorage is idempotent — does not re-migrate once flag is set", async () => {
    asyncStore["rivr.storage_migrated_v1"] = "1";
    // Put something in SecureStore to verify it isn't overwritten.
    secureStore["rivr.access"] = "existing_in_secure";

    await initTokenStorage();

    // Must not have touched the value.
    expect(secureStore["rivr.access"]).toBe("existing_in_secure");
  });

  it("keeps AsyncStorage tokens and does NOT set the flag when SecureStore write fails", async () => {
    // Pre-migration state with tokens to migrate.
    asyncStore["rivr.access"] = "old_access";
    asyncStore["rivr.refresh"] = "old_refresh";

    // SecureStore write throws — simulates Keychain/Keystore failure.
    setItemAsyncMock.mockRejectedValue(new Error("keychain unavailable"));

    await initTokenStorage();

    // The user must NOT be logged out: AsyncStorage tokens are retained...
    expect(asyncStore["rivr.access"]).toBe("old_access");
    expect(asyncStore["rivr.refresh"]).toBe("old_refresh");
    // ...and the migration flag is NOT set, so it retries next launch.
    expect(asyncStore["rivr.storage_migrated_v1"]).toBeUndefined();
  });
});
