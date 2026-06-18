/**
 * Avatar upload, caching, and display utilities.
 *
 * SECURITY: Avatar images are now cached on the device file-system
 * (expo-file-system / documentDirectory) instead of base64 in AsyncStorage.
 * AsyncStorage is plaintext and readable by other apps on Android and by
 * forensic tools on non-jailbroken iOS.  The documentDirectory is
 * app-sandboxed on both platforms.
 *
 * clearAvatarCache() is called on every sign-out via SessionContext so cached
 * photos don't persist after the user logs out.
 *
 * MIGRATION: On first run after this upgrade, any avatar entries that still
 * exist in AsyncStorage are moved to the file-system cache and then deleted.
 */

import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
// expo-file-system v19 moved documentDirectory / EncodingType to the /legacy entrypoint.
import * as FileSystem from "expo-file-system/legacy";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

import { updateProfile, uploadAvatar as uploadAvatarApi, getAvatar } from "./api/data";

const AVATAR_DIM = 512;
const JPEG_QUALITY = 0.8;

// documentDirectory is app-sandboxed on both iOS and Android.
// Non-null assertion: documentDirectory is only null on web, where this module
// is not used (web falls back to network URLs without a local cache).
const CACHE_DIR = `${FileSystem.documentDirectory!}avatar-cache/`;
const MIGRATION_KEY = "rivr.avatar_migration_v1";

// ── helpers ───────────────────────────────────────────────────────────────────

function cacheFilePath(avatarPath: string): string {
  // Replace slashes so path segments become a flat filename.
  const safe = avatarPath.replace(/\//g, "_");
  return `${CACHE_DIR}${safe}`;
}

async function ensureCacheDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.onloadend = () => {
      const r = reader.result;
      if (typeof r === "string") resolve(r);
      else reject(new Error("FileReader returned non-string"));
    };
    reader.readAsDataURL(blob);
  });
}

// ── migration ─────────────────────────────────────────────────────────────────

/**
 * One-time migration: moves avatar data-URIs from AsyncStorage into the
 * file-system cache, then deletes the AsyncStorage entries.
 * Idempotent: the migration flag prevents re-runs.
 */
export async function migrateAvatarCache(): Promise<void> {
  let done: string | null = null;
  try {
    done = await AsyncStorage.getItem(MIGRATION_KEY);
  } catch {
    // If unreadable assume not migrated.
  }
  if (done) return;

  try {
    await ensureCacheDir();
    const allKeys = await AsyncStorage.getAllKeys();
    const avatarKeys = allKeys.filter((k) => k.startsWith("avatar:"));

    for (const key of avatarKeys) {
      try {
        const dataUri = await AsyncStorage.getItem(key);
        if (dataUri) {
          const path = key.slice("avatar:".length); // strip prefix
          await FileSystem.writeAsStringAsync(cacheFilePath(path), dataUri, {
            encoding: FileSystem.EncodingType.UTF8,
          });
        }
      } catch (e) {
        console.warn(`[Avatar] Migration failed for ${key}:`, e);
      }
      try {
        await AsyncStorage.removeItem(key);
      } catch {
        // Stale key — not critical.
      }
    }
  } catch (e) {
    console.warn("[Avatar] Migration error:", e);
  } finally {
    try {
      await AsyncStorage.setItem(MIGRATION_KEY, "1");
    } catch {
      // Non-fatal — migration will retry next launch.
    }
  }
}

// Run migration at module load (native only; no-op on web).
migrateAvatarCache().catch((e) => console.warn("[Avatar] Migration startup error:", e));

// ── cache management ──────────────────────────────────────────────────────────

/**
 * Delete all cached avatars.  Called on sign-out so a subsequent user on the
 * same device does not see a previous user's photo.
 */
export async function clearAvatarCache(): Promise<void> {
  try {
    await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
  } catch (e) {
    console.warn("[Avatar] Failed to clear cache:", e);
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Resize + re-encode the source image to a 512×512 JPEG, upload it,
 * patch user_profiles.avatar_path, and warm the on-device file cache.
 * Strips EXIF/GPS metadata as a side-effect of re-encoding.
 */
export async function uploadAvatar(userId: string, sourceUri: string): Promise<string> {
  if (!userId) throw new Error("uploadAvatar: userId required");
  if (!sourceUri) throw new Error("uploadAvatar: sourceUri required");

  const manipulated = await manipulateAsync(
    sourceUri,
    [{ resize: { width: AVATAR_DIM, height: AVATAR_DIM } }],
    { compress: JPEG_QUALITY, format: SaveFormat.JPEG },
  );

  const path = `${userId}/avatar.jpg`;

  const res = await fetch(manipulated.uri);
  if (!res.ok) throw new Error(`Failed to read manipulated image (${res.status})`);
  const blob = await res.blob();

  await uploadAvatarApi(blob as any);
  await updateProfile({ avatar_path: path });

  // Warm file-system cache.
  try {
    await ensureCacheDir();
    const dataUri = await blobToDataUri(blob);
    await FileSystem.writeAsStringAsync(cacheFilePath(path), dataUri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch {
    // Cache warm is best-effort.
  }

  return path;
}

/**
 * Remove the avatar from remote storage and clear the local file cache entry.
 */
export async function removeAvatar(userId: string, currentPath: string | null): Promise<void> {
  if (!userId) throw new Error("removeAvatar: userId required");

  if (currentPath) {
    try {
      await FileSystem.deleteAsync(cacheFilePath(currentPath), { idempotent: true });
    } catch {
      // Idempotent — already absent is fine.
    }
  }

  await updateProfile({ avatar_path: null });
}

/**
 * Return the cached local file path for an avatar, or null if not cached.
 */
async function getCachedAvatarUri(avatarPath: string): Promise<string | null> {
  try {
    const filePath = cacheFilePath(avatarPath);
    const info = await FileSystem.getInfoAsync(filePath);
    return info.exists ? filePath : null;
  } catch {
    return null;
  }
}

/**
 * Returns a stable URI to display the avatar, reading from the file-system
 * cache first for instant rendering, then refreshing in the background.
 *
 * Behaviour:
 *   - null/undefined avatarPath → returns null
 *   - cache hit                 → return file URI immediately, then refresh
 *   - no cache, network OK      → fetch, write to cache, return file URI
 *   - no cache, fetch fails     → return signed URL directly as fallback
 *   - no cache, sign fails      → return null
 *   - cache hit, network fails  → keep cached URI on screen
 */
export function useAvatarUrl(avatarPath: string | null | undefined): string | null {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!avatarPath) {
        setUri(null);
        return;
      }

      // 1. File cache check — renders without a network round-trip.
      let cached: string | null = null;
      try {
        cached = await getCachedAvatarUri(avatarPath);
      } catch {
        // Treat as not-cached.
      }
      if (cancelled) return;
      if (cached) setUri(cached);

      // 2. Background refresh so cross-device photo changes are eventually visible.
      try {
        const { url } = await getAvatar();
        if (cancelled) return;
        if (!url) {
          if (!cached) setUri(null);
          return;
        }

        const res = await fetch(url);
        if (cancelled) return;
        if (!res.ok) {
          if (!cached) setUri(url); // signed URL fallback
          return;
        }

        const blob = await res.blob();
        const dataUri = await blobToDataUri(blob);
        if (cancelled) return;

        try {
          await ensureCacheDir();
          const filePath = cacheFilePath(avatarPath);
          await FileSystem.writeAsStringAsync(filePath, dataUri, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          setUri(filePath);
        } catch {
          // Cache write failed — still show the remote URL.
          setUri(url);
        }
      } catch {
        if (!cached) setUri(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [avatarPath]);

  return uri;
}
