import { useEffect, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
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

/** Local on-disk cache dir for downloaded avatar bytes. Survives app restart. */
const CACHE_DIR = `${FileSystem.cacheDirectory}avatar-cache/`;

/** File-name-safe version of a storage path used as the cache key. */
function cacheFileFor(avatarPath: string): string {
  return `${CACHE_DIR}${avatarPath.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}

async function ensureCacheDir(): Promise<void> {
  try {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  } catch {
    // Already exists — ignore.
  }
}

/**
 * Resize + re-encode the source image to a 512x512 JPEG, upload it to
 * `profile-pictures/{userId}/avatar.jpg`, and patch user_profiles.avatar_path.
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

  // Warm the local cache with the bytes we just uploaded so the avatar shows
  // instantly on the next render without a round-trip to download what we
  // already have on disk.
  try {
    await ensureCacheDir();
    await FileSystem.copyAsync({ from: manipulated.uri, to: cacheFileFor(path) });
  } catch {
    // Cache warm is best-effort — the hook will fall back to a network fetch.
  }

  return path;
}

/**
 * Delete the avatar object from storage and clear avatar_path on the profile row.
 */
export async function removeAvatar(userId: string, currentPath: string | null): Promise<void> {
  if (!userId) throw new Error("removeAvatar: userId required");

  if (currentPath) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([currentPath]);
    if (rmErr) throw rmErr;

    // Best-effort: also clear the on-disk cache so the next load doesn't
    // briefly show the deleted photo before the hook realizes it's gone.
    try {
      await FileSystem.deleteAsync(cacheFileFor(currentPath), { idempotent: true });
    } catch {
      // Idempotent — ignore.
    }
  }

  await upsertProfile(userId, { avatar_path: null });
}

/**
 * Returns a stable URI to display the avatar. The hook prefers a locally
 * cached file (instant display + survives app restart) and refreshes the
 * bytes in the background by re-downloading via a short-lived signed URL.
 *
 * Behaviour by case:
 *
 *   - avatarPath is null / undefined            → returns null
 *   - cached file exists                        → return file:// URI immediately,
 *                                                 then refresh bytes in background
 *   - no cached file                            → wait for sign + download,
 *                                                 then return file:// URI
 *   - download fails and we have a cached file  → keep showing the cached file
 *   - download fails and no cached file         → returns null
 *
 * The returned URI carries a `?v=…` query param so RN's <Image> reloads when
 * the underlying file is rewritten by a background refresh.
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

      const cacheFile = cacheFileFor(avatarPath);

      // 1. Show cached file immediately if it exists.
      let cachedExists = false;
      try {
        const info = await FileSystem.getInfoAsync(cacheFile);
        if (cancelled) return;
        if (info.exists) {
          cachedExists = true;
          const mtime =
            "modificationTime" in info && typeof info.modificationTime === "number"
              ? info.modificationTime
              : 0;
          setUri(`${cacheFile}?v=${Math.floor(mtime)}`);
        }
      } catch {
        // Treat as not-cached.
      }

      // 2. Refresh the cache in the background by signing + downloading
      //    fresh bytes. If we had no cache, this is the only path that
      //    sets the URI; if we did, the new URI's `?v=` differs so RN
      //    reloads the image after the file is rewritten.
      try {
        await ensureCacheDir();
        const { data, error } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(avatarPath, SIGNED_URL_TTL_S);
        if (cancelled) return;
        if (error || !data?.signedUrl) {
          if (!cachedExists) setUri(null);
          return;
        }

        const result = await FileSystem.downloadAsync(data.signedUrl, cacheFile);
        if (cancelled) return;
        if (result.status === 200) {
          setUri(`${cacheFile}?v=${Date.now()}`);
        } else if (!cachedExists) {
          // Couldn't write the cache and we have nothing on disk — fall back
          // to the signed URL directly so the user still sees their photo.
          setUri(data.signedUrl);
        }
      } catch {
        // Background refresh failure: if we already showed a cached file,
        // leave the URI alone; otherwise null out.
        if (!cachedExists) setUri(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [avatarPath]);

  return uri;
}
