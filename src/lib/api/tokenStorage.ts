/**
 * Secure token storage for RIVR Health.
 *
 * Native (iOS/Android): uses expo-secure-store, which is backed by
 * iOS Keychain and Android Keystore — hardware-backed, inaccessible
 * to other apps even on rooted devices.
 *
 * Web: uses sessionStorage (volatile — cleared on tab close). NOT
 * localStorage, which persists and is accessible to any JS on the origin.
 *
 * Migration: on first run after this upgrade, any tokens that exist in
 * AsyncStorage (old storage) are moved to SecureStore so already-logged-in
 * users are NOT logged out.
 */

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const ACCESS_KEY = "rivr.access";
const REFRESH_KEY = "rivr.refresh";
const MIGRATION_DONE_KEY = "rivr.storage_migrated_v1";

/**
 * Called once at app startup. Reads any tokens that may exist in plaintext
 * AsyncStorage (from before this migration), writes them into SecureStore,
 * then removes them from AsyncStorage so they no longer sit in plaintext.
 * After the first run the migration flag prevents this from repeating.
 */
export async function initTokenStorage(): Promise<void> {
  if (Platform.OS === "web") return; // Web uses sessionStorage — no migration needed.

  let alreadyMigrated: string | null = null;
  try {
    alreadyMigrated = await AsyncStorage.getItem(MIGRATION_DONE_KEY);
  } catch {
    // If we can't read the flag, assume migration hasn't run — try it.
  }
  if (alreadyMigrated) return;

  try {
    const oldAccess = await AsyncStorage.getItem(ACCESS_KEY);
    const oldRefresh = await AsyncStorage.getItem(REFRESH_KEY);
    if (oldAccess) await SecureStore.setItemAsync(ACCESS_KEY, oldAccess);
    if (oldRefresh) await SecureStore.setItemAsync(REFRESH_KEY, oldRefresh);
  } catch (e) {
    // Migration failure is non-fatal — the user may need to re-login.
    console.warn("[TokenStorage] Migration failed:", e);
  } finally {
    try {
      await AsyncStorage.setItem(MIGRATION_DONE_KEY, "1");
      await AsyncStorage.multiRemove([ACCESS_KEY, REFRESH_KEY]);
    } catch (e) {
      console.warn("[TokenStorage] Cleanup after migration failed:", e);
    }
  }
}

export async function setTokens(access: string, refresh?: string): Promise<void> {
  if (Platform.OS === "web") {
    sessionStorage.setItem(ACCESS_KEY, access);
    if (refresh) sessionStorage.setItem(REFRESH_KEY, refresh);
    return;
  }
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  if (refresh) await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function clearTokens(): Promise<void> {
  if (Platform.OS === "web") {
    sessionStorage.removeItem(ACCESS_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    return;
  }
  // Delete from SecureStore; also sweep any lingering AsyncStorage entries.
  await Promise.allSettled([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
    AsyncStorage.multiRemove([ACCESS_KEY, REFRESH_KEY]),
  ]);
}

export async function getAccessToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return sessionStorage.getItem(ACCESS_KEY) ?? null;
  }
  try {
    return await SecureStore.getItemAsync(ACCESS_KEY);
  } catch (e) {
    console.warn("[TokenStorage] Failed to read access token:", e);
    return null;
  }
}

export async function getRefreshToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return sessionStorage.getItem(REFRESH_KEY) ?? null;
  }
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY);
  } catch (e) {
    console.warn("[TokenStorage] Failed to read refresh token:", e);
    return null;
  }
}
