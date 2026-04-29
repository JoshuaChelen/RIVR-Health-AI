import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

import { supabase } from "./supabase";
import { upsertProfile } from "./profile";

const BUCKET = "profile-pictures";

/** Edge of the square output. Matches the in-app avatar circle's max display size at 2x. */
const AVATAR_DIM = 512;

/** JPEG quality. 0.8 balances size and visual fidelity for face photos at 512px. */
const JPEG_QUALITY = 0.8;

/** TTL for signed URLs. Long enough for a typical screen session, short enough to limit blast radius. */
const SIGNED_URL_TTL_S = 600;

/** AsyncStorage key for the persistent data-URI cache, scoped by storage path. */
const cacheKeyFor = (avatarPath: string) => `avatar:${avatarPath}`;

/**
 * Convert a Blob (from fetch().blob() or manipulator output) to a base64
 * data URI we can safely persist in AsyncStorage and feed to <Image source={{uri}}>.
 */
async function blobToDataUri(blob: Blob): Promise<string> {
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

/**
 * Resize + re-encode the source image to a 512×512 JPEG, upload it to
 * `profile-pictures/{userId}/avatar.jpg`, patch user_profiles.avatar_path,
 * and warm the on-device cache with the bytes so the next mount renders
 * instantly with no network round-trip.
 *
 * The re-encode strips EXIF / GPS metadata as a side effect.
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

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (uploadErr) throw uploadErr;

  await upsertProfile(userId, { avatar_path: path });

  // Warm the persistent cache with the bytes we just uploaded. AsyncStorage
  // uses IndexedDB/localStorage on web and SQLite/SharedPreferences on
  // native — same semantics across platforms, persists across app restart.
  try {
    const dataUri = await blobToDataUri(blob);
    await AsyncStorage.setItem(cacheKeyFor(path), dataUri);
  } catch {
    // Cache warm is best-effort — the hook will fall back to a network fetch.
  }

  return path;
}

/**
 * Delete the avatar object from storage, clear the persistent cache so the
 * next render doesn't briefly show a deleted photo, then null out
 * user_profiles.avatar_path.
 */
export async function removeAvatar(userId: string, currentPath: string | null): Promise<void> {
  if (!userId) throw new Error("removeAvatar: userId required");

  if (currentPath) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([currentPath]);
    if (rmErr) throw rmErr;

    try {
      await AsyncStorage.removeItem(cacheKeyFor(currentPath));
    } catch {
      // Idempotent — ignore.
    }
  }

  await upsertProfile(userId, { avatar_path: null });
}

/**
 * Returns a stable URI to display the avatar, caching bytes locally in
 * AsyncStorage for instant rendering on every mount and after app restart.
 *
 * Behaviour by case:
 *
 *   - avatarPath is null / undefined           → returns null
 *   - cache hit                                → return cached data URI immediately,
 *                                                then refresh in background
 *   - no cache, network OK                     → wait for sign + fetch + decode,
 *                                                then return the data URI
 *   - no cache, fetch fails                    → returns the signed URL directly
 *                                                so the user still sees the photo
 *   - no cache, sign fails                     → returns null
 *   - cache hit, network fails                 → keeps the cached URI on screen
 *
 * Persistence: AsyncStorage uses IndexedDB / localStorage on web and
 * SQLite / SharedPreferences on native. Both survive app restart and
 * device reboot.
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

      const key = cacheKeyFor(avatarPath);

      // 1. Persistent cache check. Renders instantly without a single
      //    network call when the user has visited any avatar-displaying
      //    screen before.
      let cached: string | null = null;
      try {
        cached = await AsyncStorage.getItem(key);
      } catch {
        // Treat as not-cached.
      }
      if (cancelled) return;
      if (cached) setUri(cached);

      // 2. Background refresh: fetch the latest bytes so cross-device photo
      //    changes are eventually reflected. The cached URI stays on screen
      //    while this runs; we only swap the URI if the bytes actually changed.
      try {
        const { data, error } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(avatarPath, SIGNED_URL_TTL_S);
        if (cancelled) return;
        if (error || !data?.signedUrl) {
          if (!cached) setUri(null);
          return;
        }

        const res = await fetch(data.signedUrl);
        if (cancelled) return;
        if (!res.ok) {
          // Fetch failed (auth, network, deleted, etc.). If we had no cache,
          // fall back to the signed URL directly so the user still sees the
          // photo via RN's <Image> network loader.
          if (!cached) setUri(data.signedUrl);
          return;
        }

        const blob = await res.blob();
        const dataUri = await blobToDataUri(blob);
        if (cancelled) return;

        if (dataUri !== cached) {
          await AsyncStorage.setItem(key, dataUri).catch(() => {});
          setUri(dataUri);
        }
      } catch {
        // Background refresh failure: leave any cached URI in place;
        // otherwise null out (no cache, no network).
        if (!cached) setUri(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [avatarPath]);

  return uri;
}
