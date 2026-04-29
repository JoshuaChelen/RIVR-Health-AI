import { useEffect, useRef, useState } from "react";
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

/** Re-sign this many seconds before expiry to avoid a flash of broken image. */
const REFRESH_LEAD_S = 60;

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
  }

  await upsertProfile(userId, { avatar_path: null });
}

/**
 * Returns a signed URL for the given avatar path and refreshes before expiry.
 */
export function useAvatarUrl(avatarPath: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const sign = async () => {
      if (!avatarPath) {
        setUrl(null);
        return;
      }

      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(avatarPath, SIGNED_URL_TTL_S);

      if (cancelledRef.current) return;
      if (error || !data?.signedUrl) {
        setUrl(null);
        return;
      }

      setUrl(data.signedUrl);

      const ms = Math.max(1000, (SIGNED_URL_TTL_S - REFRESH_LEAD_S) * 1000);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        sign();
      }, ms);
    };

    sign();

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [avatarPath]);

  return url;
}
