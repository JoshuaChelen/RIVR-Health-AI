# Profile Picture (3×5 ER Card) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload, change, and remove a profile photo from inside the app, and embed that photo on the 3×5 emergency-card share PDF so an ER triage nurse can confirm the card matches the patient in front of them.

**Architecture:** Avatar bytes live in a new private Supabase Storage bucket `profile-pictures` keyed by `{user_id}/avatar.jpg`, with `user_profiles.avatar_path` pointing at the object. App reads via short-lived signed URLs through a single `src/lib/avatar.ts` module; the `create-share-package` edge function pulls bytes server-side and embeds them as a data URI on the 3×5 card PDF only. Other share types stay text-only.

**Tech Stack:** Expo / React Native / TypeScript app. Supabase Postgres + Storage + Edge Functions (Deno). PDF generation via `pdf-lib@1.17.1`. Image manipulation via `expo-image-manipulator` (already in deps). Project has no Jest/Vitest — verification is `tsc --noEmit` plus a manual smoke test in Task 10.

**Spec:** `docs/superpowers/specs/2026-04-29-profile-picture-design.md`

---

## File map

**Modify (existing):**

- `src/lib/profile.ts` — add `avatar_path?: string | null` to `UserProfile` (Task 2).
- `src/screens/App/ProfileScreen.tsx` — wrap the existing `avatarCircle` in a Pressable; mount the picker sheet; render the loaded image (Task 5).
- `src/screens/App/HealthSummaryScreen.tsx` — render a small avatar at the top of the 3×5 card preview section (Task 6).
- `supabase/functions/_shared/pdf-builders.ts` — extend `buildCard3x5Pdf` signature with `opts.avatarDataUri` and embed the image top-right (Task 7).
- `supabase/functions/create-share-package/index.ts` — for `card_3x5` shares, fetch + base64-encode the avatar and pass to the builder (Task 8).
- `supabase/functions/delete-account/index.ts` — sweep `profile-pictures/{userId}/` on account deletion (Task 9).

**Create (new):**

- `src/lib/avatar.ts` — single source of truth for avatar I/O (upload, remove, signed-URL hook). (Task 3)
- `src/components/ui/Profile/AvatarPickerSheet.tsx` — bottom-sheet modal: Take photo / Choose from library / Remove photo. (Task 4)

**Operational (not code):**

- One-shot SQL in the Supabase dashboard SQL editor: ALTER TABLE + create bucket + four RLS policies (Task 1).
- Edge function deploys: `create-share-package`, `delete-account` (Tasks 8 and 9).

---

## Task 1: One-shot SQL — column, bucket, RLS policies

**Files:**
- Operational only (Supabase dashboard SQL editor). The repo has no `supabase/migrations/` folder; schema is dashboard-managed.

- [ ] **Step 1: Run this SQL block in the Supabase dashboard SQL editor.**

```sql
-- 1. New nullable column on user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS avatar_path text;

-- 2. New private bucket for profile photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-pictures', 'profile-pictures', false)
ON CONFLICT (id) DO NOTHING;

-- 3. RLS: a user can read / write / update / delete only objects under
--    their own folder, identified by the first path segment matching auth.uid()
CREATE POLICY "users read own avatar" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'profile-pictures'
         AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "users write own avatar" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'profile-pictures'
              AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "users update own avatar" ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'profile-pictures'
         AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "users delete own avatar" ON storage.objects
  FOR DELETE
  USING (bucket_id = 'profile-pictures'
         AND (storage.foldername(name))[1] = auth.uid()::text);
```

The PDF-building edge function uses the **service role key**, which bypasses these policies, so it can read any user's avatar when building their own share package.

- [ ] **Step 2: Verify the bucket and policies are in place.**

```sql
-- Bucket
SELECT id, public FROM storage.buckets WHERE id = 'profile-pictures';
-- Expected: id = 'profile-pictures', public = false

-- Policies
SELECT polname FROM pg_policies
WHERE tablename = 'objects'
  AND polname IN (
    'users read own avatar',
    'users write own avatar',
    'users update own avatar',
    'users delete own avatar'
  );
-- Expected: 4 rows

-- Column
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_profiles'
  AND column_name = 'avatar_path';
-- Expected: column_name = 'avatar_path', is_nullable = 'YES'
```

- [ ] **Step 3: No commit needed — DB-only change tracked in the spec.** Confirm with the user that the SQL ran cleanly before proceeding to Task 2.

---

## Task 2: Add `avatar_path` to the `UserProfile` type

**Files:**
- Modify: `src/lib/profile.ts`

- [ ] **Step 1: Find the `UserProfile` type and add the new field.**

Find this block (around lines 50–55):

```ts
  first_name: string;
  last_name: string;
  date_of_birth: string | null;     // ISO: YYYY-MM-DD
```

Locate the closing `}` of the `UserProfile` type (before `created_at`) and add the new field there. Specifically, find:

```ts
  ai_backfill_meta?: AiBackfillMeta | null;

  created_at: string;
  updated_at: string;
};
```

Replace with:

```ts
  ai_backfill_meta?: AiBackfillMeta | null;

  /** Storage path inside the `profile-pictures` bucket. e.g. `{user_id}/avatar.jpg`. */
  avatar_path?: string | null;

  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 2: Type-check.**

```bash
npx tsc --noEmit
```

Expected: no new errors in `src/`.

- [ ] **Step 3: Commit.**

```bash
git add src/lib/profile.ts
git commit -m "profile: add avatar_path to UserProfile

Optional storage path pointing at the user's profile photo in the
new profile-pictures bucket. Nullable when the user has no photo
uploaded yet."
```

---

## Task 3: Avatar library — `src/lib/avatar.ts`

**Files:**
- Create: `src/lib/avatar.ts`

This module owns every avatar I/O path: upload (resize + JPEG), remove (delete object + clear column), and a hook that returns a signed URL with auto-refresh.

- [ ] **Step 1: Create the file.**

Write to `src/lib/avatar.ts`:

```ts
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
 * Resize + re-encode the source image to a 512×512 JPEG, upload it to
 * `profile-pictures/{userId}/avatar.jpg`, and patch user_profiles.avatar_path.
 *
 * The re-encode strips EXIF / GPS metadata as a side effect — important for
 * face photos where the original might carry location data from the camera.
 *
 * Throws on any failure. Caller is responsible for surfacing the error.
 *
 * Returns the storage path that was written.
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

  // Read the manipulated file's bytes. fetch() works for file:// (native) and
  // blob: (web) URIs that expo-image-manipulator returns.
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
 * Delete the avatar object from storage AND clear avatar_path on the row.
 * Both happen as one logical operation; if storage delete fails, we don't
 * touch the row, so a re-attempt is safe.
 *
 * Pass the current avatar_path so we can target the exact object. If null
 * is passed (already removed), we still patch the row to ensure consistency.
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
 * Hook that returns a signed URL for the given avatar path, refreshing it
 * REFRESH_LEAD_S seconds before TTL expiry. Returns null when avatarPath is
 * null / undefined (no avatar set) or while the first sign() request is in flight.
 *
 * Cleans up its refresh timer on unmount or path change.
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
      // Schedule the next sign() before the URL expires.
      const ms = Math.max(1000, (SIGNED_URL_TTL_S - REFRESH_LEAD_S) * 1000);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { sign(); }, ms);
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
```

- [ ] **Step 2: Type-check.**

```bash
npx tsc --noEmit
```

Expected: no new errors in `src/`.

- [ ] **Step 3: Commit.**

```bash
git add src/lib/avatar.ts
git commit -m "add src/lib/avatar.ts — upload, remove, signed URL hook

Single source of truth for the new profile-photo storage path:
- uploadAvatar resizes to 512x512 JPEG via expo-image-manipulator
  (which strips EXIF/GPS as a side effect) and writes to
  profile-pictures/{userId}/avatar.jpg with upsert, then patches
  user_profiles.avatar_path.
- removeAvatar deletes the bucket object and clears avatar_path.
- useAvatarUrl signs the path with a 10-min TTL and refreshes 1 min
  before expiry. Returns null when path is null."
```

---

## Task 4: AvatarPickerSheet — bottom-sheet modal

**Files:**
- Create: `src/components/ui/Profile/AvatarPickerSheet.tsx`

This is the bottom sheet that appears when the user taps the avatar circle. Three rows: Take photo / Choose from library / Remove photo (last only when an avatar is set). Visual style mirrors the existing `DuplicateConfirmModal` in `src/components/ui/ManageDocuments/UploadFile.tsx`: translucent backdrop, bottom-anchored sheet with a teal accent bar.

- [ ] **Step 1: Create the file.**

Write to `src/components/ui/Profile/AvatarPickerSheet.tsx`:

```tsx
import React from "react";
import { Modal, View, StyleSheet, Pressable } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { AppText } from "../Primitives/AppText";
import { spacing, radius, typescale, shadows } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useTheme } from "../../../context/ThemeContext";

type Props = {
  visible: boolean;
  /** True when the user already has a photo — controls whether the Remove row is rendered. */
  hasPhoto: boolean;
  onTakePhoto: () => void;
  onChooseFromLibrary: () => void;
  onRemovePhoto: () => void;
  onClose: () => void;
};

export function AvatarPickerSheet({
  visible,
  hasPhoto,
  onTakePhoto,
  onChooseFromLibrary,
  onRemovePhoto,
  onClose,
}: Props) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.accentBar} />
          <View style={styles.body}>
            <AppText style={styles.title}>Profile photo</AppText>
            <AppText style={styles.message}>
              Used on your 3×5 emergency card so a provider can match the card to you.
            </AppText>

            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Take photo"
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              onPress={onTakePhoto}
            >
              <View style={styles.iconWrap}>
                <Ionicons name="camera-outline" size={18} color={colors.teal} />
              </View>
              <AppText style={styles.rowText}>Take photo</AppText>
            </Pressable>

            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Choose from library"
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              onPress={onChooseFromLibrary}
            >
              <View style={styles.iconWrap}>
                <Ionicons name="images-outline" size={18} color={colors.teal} />
              </View>
              <AppText style={styles.rowText}>Choose from library</AppText>
            </Pressable>

            {hasPhoto ? (
              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                onPress={onRemovePhoto}
              >
                <View style={[styles.iconWrap, styles.iconWrapDanger]}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </View>
                <AppText style={[styles.rowText, styles.rowTextDanger]}>Remove photo</AppText>
              </Pressable>
            ) : null}

            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.7 }]}
              onPress={onClose}
            >
              <AppText style={styles.cancelText}>Cancel</AppText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = createStyles((c) => ({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(13,27,42,0.45)",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  } as const,
  sheet: {
    width: "100%",
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    overflow: "hidden",
    ...shadows.lg,
  } as const,
  accentBar: {
    height: 4,
    backgroundColor: c.teal,
  } as const,
  body: {
    padding: spacing.lg,
    gap: spacing.sm,
  } as const,
  title: {
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.bold,
    color: c.text,
  } as const,
  message: {
    fontSize: typescale.size.sm,
    color: c.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
    marginBottom: spacing.xs,
  } as const,
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  } as const,
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: c.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  } as const,
  iconWrapDanger: {
    backgroundColor: c.dangerSoft,
  } as const,
  rowText: {
    fontSize: typescale.size.base,
    color: c.text,
    fontWeight: typescale.weight.medium,
  } as const,
  rowTextDanger: {
    color: c.danger,
  } as const,
  cancel: {
    marginTop: spacing.xs,
    height: 46,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.bgSecondary,
    borderWidth: 1,
    borderColor: c.border,
  } as const,
  cancelText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: c.textSub,
  } as const,
}));
```

- [ ] **Step 2: Type-check.**

```bash
npx tsc --noEmit
```

Expected: no new errors in `src/`. If a token like `dangerSoft` is missing on the theme, `tsc` will flag it — verify by reading `src/theme/tokens.ts` first if errors appear (the existing `ListDocuments` already uses `dangerSoft`, so it should resolve).

- [ ] **Step 3: Commit.**

```bash
git add src/components/ui/Profile/AvatarPickerSheet.tsx
git commit -m "add AvatarPickerSheet — bottom sheet for profile photo

Three rows: Take photo, Choose from library, Remove photo (last
only when hasPhoto). Visual style matches DuplicateConfirmModal:
translucent backdrop, bottom-anchored sheet, teal accent bar."
```

---

## Task 5: ProfileScreen — wrap avatar circle, mount picker, show image

**Files:**
- Modify: `src/screens/App/ProfileScreen.tsx`

The existing avatar circle at line 326 displays initials. We're going to:
1. Add state for the picker sheet, busy/error indicator, and the chosen image URI.
2. Wrap the circle in a Pressable that opens the sheet.
3. Render an `<Image>` overlaid on top of the initials when an avatar is set, so the initials remain as a fallback while loading.
4. Implement the camera / library / remove handlers.

- [ ] **Step 1: Add imports.**

Find the existing import block at the top of the file. Add to the React Native imports if not already present (`Pressable`, `Image`, `Alert`, `Platform`):

```ts
import { /* existing imports */, Pressable, Image, Alert, Platform } from "react-native";
```

If any of those are already imported, leave them. After the React Native import block, add:

```ts
import * as ImagePicker from "expo-image-picker";

import { AvatarPickerSheet } from "../../components/ui/Profile/AvatarPickerSheet";
import { uploadAvatar, removeAvatar, useAvatarUrl } from "../../lib/avatar";
```

- [ ] **Step 2: Add state hooks inside the `ProfileScreen` component body, near the other useState calls.**

Find a section of useState calls in the component. Add these:

```ts
  const [pickerOpen, setPickerOpen]   = useState(false);
  const [avatarBusy, setAvatarBusy]   = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const avatarUrl = useAvatarUrl(profile?.avatar_path ?? null);
```

(Where `profile` is the existing variable holding the loaded `UserProfile`. If the variable is named differently, substitute — e.g., `userProfile?.avatar_path`. Confirm by reading the file before editing.)

- [ ] **Step 3: Add handler functions after the state declarations and before the return().**

```ts
  const launchPicker = useCallback(async (mode: "camera" | "library") => {
    setPickerOpen(false);
    setAvatarError(null);

    // Permission requests are no-ops on web (the browser manages its own
    // dialogs) and required on native.
    if (Platform.OS !== "web") {
      const perm = mode === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setAvatarError(
          mode === "camera"
            ? "Allow camera access in your device settings to take a photo."
            : "Allow photo library access in your device settings.",
        );
        return;
      }
    }

    const result = mode === "camera"
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: "images",
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.9,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: "images",
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.9,
        });

    if (result.canceled || !result.assets?.[0]?.uri) return;

    if (!profile?.user_id) {
      setAvatarError("Sign in to update your photo.");
      return;
    }

    setAvatarBusy(true);
    try {
      await uploadAvatar(profile.user_id, result.assets[0].uri);
      // Re-fetch the profile so avatar_path lands in state and useAvatarUrl re-signs.
      await reloadProfile();
    } catch (e: any) {
      setAvatarError(e?.message ?? "Failed to upload photo.");
    } finally {
      setAvatarBusy(false);
    }
  }, [profile?.user_id, reloadProfile]);

  const handleRemove = useCallback(async () => {
    setPickerOpen(false);
    setAvatarError(null);
    if (!profile?.user_id) return;

    setAvatarBusy(true);
    try {
      await removeAvatar(profile.user_id, profile.avatar_path ?? null);
      await reloadProfile();
    } catch (e: any) {
      setAvatarError(e?.message ?? "Failed to remove photo.");
    } finally {
      setAvatarBusy(false);
    }
  }, [profile?.user_id, profile?.avatar_path, reloadProfile]);
```

(`reloadProfile` is the existing function/handler in this screen that re-runs the `getProfile` query. If the screen uses a different name — `loadProfile`, `refresh`, or refetch from a hook — substitute. **Read the file first to find the exact name** before applying the edit.)

- [ ] **Step 4: Wrap the existing avatar circle in a Pressable and render the image overlay.**

Find this block (around lines 325–330):

```tsx
          <View style={styles.header}>
            <View style={styles.avatarCircle}>
              <AppText style={styles.avatarText}>
                {initials || "?"}
              </AppText>
            </View>
```

Replace with:

```tsx
          <View style={styles.header}>
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
              onPress={() => setPickerOpen(true)}
              style={styles.avatarCircle}
              disabled={avatarBusy}
            >
              <AppText style={styles.avatarText}>
                {initials || "?"}
              </AppText>
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={styles.avatarImage}
                  accessibilityLabel="Profile photo"
                />
              ) : null}
              {avatarBusy ? (
                <View style={styles.avatarBusyOverlay}>
                  <ActivityIndicator color="#fff" size="small" />
                </View>
              ) : null}
            </Pressable>
```

The closing `</View>` of `styles.avatarCircle` is gone — `Pressable` is now the outer element. The image is layered ON TOP of the initials, so when it's loading/missing, the initials remain visible underneath.

(Verify `ActivityIndicator` is imported at the top of the file. If not, add it to the React Native imports.)

- [ ] **Step 5: Render the picker sheet and the inline error message at the end of the component's JSX.**

Find the closing tags of the screen's outermost `Screen` / `KeyboardAvoidingView`. Just before the outermost closing tag, add:

```tsx
      <AvatarPickerSheet
        visible={pickerOpen}
        hasPhoto={!!profile?.avatar_path}
        onTakePhoto={() => launchPicker("camera")}
        onChooseFromLibrary={() => launchPicker("library")}
        onRemovePhoto={handleRemove}
        onClose={() => setPickerOpen(false)}
      />
```

For the inline error: place it directly under the avatar circle in the existing layout (e.g., inside `styles.headerText` if it exists, or as a sibling under `styles.header`):

```tsx
{avatarError ? (
  <AppText style={{ color: colors.danger, fontSize: typescale.size.xs, marginTop: spacing.xs }}>
    {avatarError}
  </AppText>
) : null}
```

- [ ] **Step 6: Add the new styles. Find the existing `styles.avatarCircle` and `styles.avatarText` definitions (around line 889–898 in the original file). Inside the same `StyleSheet.create({...})` body, add these entries:**

```ts
  avatarImage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    borderRadius: 9999,
  },
  avatarBusyOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
  },
```

Note: the existing `styles.avatarCircle` should already have `overflow: "hidden"` to clip the image into the circle. If it doesn't, add `overflow: "hidden"` to it now (look for the existing `borderRadius: 9999` line and confirm).

- [ ] **Step 7: Type-check.**

```bash
npx tsc --noEmit
```

Expected: no new errors in `src/`. Common pitfalls:
- `useCallback` not imported from `react` — add to the existing React import.
- `reloadProfile` doesn't exist on this screen — find the actual refetch function name and substitute.
- `Pressable` already had a different `style` prop type than `View` — `style={styles.avatarCircle}` is fine; both accept `ViewStyle`.

- [ ] **Step 8: Commit.**

```bash
git add src/screens/App/ProfileScreen.tsx
git commit -m "ProfileScreen: tap avatar to upload / change / remove photo

Wraps the existing avatarCircle in a Pressable that opens the new
AvatarPickerSheet. Photo loads via useAvatarUrl and renders as an
Image overlaid on top of the initials, so the initials remain
visible during load. Camera and library both launch with a square
crop step (allowsEditing + aspect [1,1]). Errors surface inline
below the circle."
```

---

## Task 6: HealthSummaryScreen — small avatar at the top of the 3×5 card preview

**Files:**
- Modify: `src/screens/App/HealthSummaryScreen.tsx`

The card preview section is the block that renders `card?.major_conditions`, `card?.allergies`, `card?.one_line_summary`, etc. We want a 64×64 round avatar to the left of `one_line_summary` (or patient name) at the top of that section. If no avatar, render nothing — the layout stays as-is.

- [ ] **Step 1: Add imports.**

Find the import block. Add:

```ts
import { Image } from "react-native"; // if not already imported
import { useAvatarUrl } from "../../lib/avatar";
```

Also import the user's profile if not already present; the screen needs `userProfile?.avatar_path`. Look for the existing way the screen gets the user profile (probably via `useEffect + getProfile` or a hook). If the screen doesn't currently load `user_profiles`, add a small `useEffect` that fetches it once on mount via `getProfile(userId)`.

- [ ] **Step 2: Inside the component body, add the hook.**

```ts
  const avatarUrl = useAvatarUrl(userProfile?.avatar_path ?? null);
```

(Where `userProfile` is the existing or newly-added local profile state. If the screen already has the profile under another name — e.g., `manualProfile`, `profile` — substitute.)

- [ ] **Step 3: Find the 3×5 card section in the JSX and add the avatar row.**

The card section is identified by `card?.major_conditions` / `card?.one_line_summary` (line 141 reads `const card = profile?.card_json ?? evaluation?.three_by_five_card ?? null;`). At the very top of the visible card body, add a row that renders the avatar to the left and the `one_line_summary` (or fallback) text to the right:

```tsx
{avatarUrl ? (
  <View style={styles.cardAvatarRow}>
    <Image
      source={{ uri: avatarUrl }}
      style={styles.cardAvatar}
      accessibilityLabel="Profile photo"
    />
    {card?.one_line_summary ? (
      <AppText style={styles.cardAvatarLabel} numberOfLines={2}>
        {card.one_line_summary}
      </AppText>
    ) : null}
  </View>
) : null}
```

Place this block immediately inside the View that wraps the card content — before the existing fields like `major_conditions`, etc. It only renders when `avatarUrl` is truthy, so users without a photo are unaffected.

- [ ] **Step 4: Add the styles.**

Inside the screen's `useStyles`/`StyleSheet.create({...})` body, add:

```ts
  cardAvatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  cardAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: c.bgSecondary,
  },
  cardAvatarLabel: {
    flex: 1,
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: c.text,
    lineHeight: typescale.size.sm * typescale.lineHeight.normal,
  },
```

(Use the same naming convention the rest of the file uses for theme tokens — `c` vs `colors` etc. Confirm by reading the existing `useStyles` block.)

- [ ] **Step 5: Type-check.**

```bash
npx tsc --noEmit
```

Expected: no new errors in `src/`.

- [ ] **Step 6: Commit.**

```bash
git add src/screens/App/HealthSummaryScreen.tsx
git commit -m "HealthSummaryScreen: avatar in the 3x5 card preview

Renders a 64x64 round avatar to the left of one_line_summary at the
top of the card section, when the user has uploaded a photo. Falls
back to the existing layout when no photo is set — no visual
regression for users who don't add one."
```

---

## Task 7: PDF builder — extend `buildCard3x5Pdf` with avatar embed

**Files:**
- Modify: `supabase/functions/_shared/pdf-builders.ts`

Add an optional `opts.avatarDataUri` argument. When present, decode the base64 portion and embed via `pdf-lib`'s `embedJpg`, drawing the image as a 56pt square (≈0.78 inch) in the top-right corner of the card with a 1pt border.

Card geometry from the existing code (lines 326–329):
- `CX = (PW - 490) / 2` — left edge of card
- `CY = (PH - 330) / 2` — bottom edge of card
- Card width 490, height 330
- Header band height 50

Avatar position:
- Square size 56pt
- Inset from right: 14pt → x = CX + 490 - 14 - 56 = CX + 420
- Inset from top: 14pt → y = CY + 330 - 14 - 56 = CY + 260
- The avatar sits over the teal header band (top ~36pt) and extends ~20pt into the white body — visually mirrors an ID-card photo.

- [ ] **Step 1: Update the function signature.**

Find:

```ts
export async function buildCard3x5Pdf(cardData: any): Promise<Uint8Array> {
  const doc     = await PDFDocument.create();
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
```

Replace with:

```ts
export async function buildCard3x5Pdf(
  cardData: any,
  opts?: { avatarDataUri?: string | null },
): Promise<Uint8Array> {
  const doc     = await PDFDocument.create();
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
```

- [ ] **Step 2: Right after the header band drawing block (just after the `dateStr` line draws the date in the top-right), insert the avatar embed.**

Find this block (around lines 354–356):

```ts
  page.drawText(dateStr, {
    x: CX + CW2 - dW - 16, y: CY + CH - 18, size: 8, font: regular, color: TEAL_SOFT,
  });
```

Right after it, add:

```ts
  // ── Profile photo (top-right) ───────────────────────────────────────────────
  // Embedded as a small ID-card-style square so the receiving provider can
  // visually match the card to the patient at triage. Best-effort: any
  // failure here must NOT break the card; we just skip the photo.
  if (opts?.avatarDataUri) {
    try {
      const AVA_SIZE = 56;
      const AVA_X    = CX + CW2 - 14 - AVA_SIZE; // 14pt inset from right
      const AVA_Y    = CY + CH - 14 - AVA_SIZE;  // 14pt inset from top

      // data URIs look like "data:image/jpeg;base64,XXXX..."
      const m = opts.avatarDataUri.match(/^data:image\/[a-zA-Z+.-]+;base64,(.+)$/);
      if (m && m[1]) {
        const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
        const img   = await doc.embedJpg(bytes);
        page.drawImage(img, { x: AVA_X, y: AVA_Y, width: AVA_SIZE, height: AVA_SIZE });
        // 1pt border around the avatar so it stays legible against either the
        // teal header band or the white card body.
        page.drawRectangle({
          x: AVA_X, y: AVA_Y, width: AVA_SIZE, height: AVA_SIZE,
          borderColor: BORDER, borderWidth: 1,
        });
      }
    } catch (_e) {
      // Swallow — the rest of the card is still useful without the photo.
    }
  }
```

(The constants `CW2`, `CX`, `CY`, `CH`, `BORDER` are already in scope from the surrounding code. `atob` is a global available in Deno's runtime — used elsewhere in the same file if you need a reference.)

- [ ] **Step 3: Verify there are no other call sites of `buildCard3x5Pdf` that pass extra arguments.**

```bash
grep -rn "buildCard3x5Pdf" /Users/darwashi/Downloads/rivr/RIVR-Health-AI --include="*.ts"
```

Expected: only the export in `pdf-builders.ts` and the call in `create-share-package/index.ts`. The new optional `opts` parameter is backward-compatible — existing call sites without the second arg keep working.

- [ ] **Step 4: Commit.**

```bash
git add supabase/functions/_shared/pdf-builders.ts
git commit -m "buildCard3x5Pdf: embed optional avatar in top-right corner

Adds an opts.avatarDataUri argument; when present, decode the base64
JPEG and embed via pdf-lib's embedJpg + drawImage as a 56pt square
inset 14pt from the top-right of the card, with a 1pt border. Sits
over the teal header band — visually mirrors an ID-card photo. The
whole block is wrapped in try/catch; any failure logs nothing and
falls back to a card without the photo, preserving the existing
behavior for users without an avatar."
```

---

## Task 8: `create-share-package` — fetch + pass avatar for `card_3x5` shares

**Files:**
- Modify: `supabase/functions/create-share-package/index.ts`

Before calling `buildCard3x5Pdf`, look up the user's `avatar_path`, download the bytes via the service role client, base64-encode them, and pass as the new `avatarDataUri` option. Wrap the whole block in try/catch — a missing or unreadable avatar must never block a share.

- [ ] **Step 1: Find the call site of `buildCard3x5Pdf` and the surrounding code.**

```bash
grep -n "buildCard3x5Pdf\|file_type" /Users/darwashi/Downloads/rivr/RIVR-Health-AI/supabase/functions/create-share-package/index.ts | head -20
```

Locate the line that calls `await buildCard3x5Pdf(...)` (or similar) inside the conditional that builds card-only shares.

- [ ] **Step 2: Right before that call, fetch the avatar.**

Insert this block immediately above the `buildCard3x5Pdf(...)` invocation. Substitute `userId` and `admin` for the variable names actually used in this file — typically `userId` is the authenticated user and `admin` is the service-role Supabase client.

```ts
    // ── Avatar (best-effort) ────────────────────────────────────────────────
    // Pull the user's profile photo from the private profile-pictures bucket
    // and pass it to the PDF builder as a base64 data URI. Best-effort: any
    // failure (no avatar set, missing file, network error) just produces a
    // card without a photo. This must NEVER fail the share creation.
    let avatarDataUri: string | null = null;
    try {
      const { data: prof } = await admin
        .from("user_profiles")
        .select("avatar_path")
        .eq("user_id", userId)
        .maybeSingle();
      const path = (prof as { avatar_path?: string | null } | null)?.avatar_path ?? null;
      if (path) {
        const { data: blob, error: dlErr } = await admin.storage
          .from("profile-pictures")
          .download(path);
        if (!dlErr && blob) {
          const buf = new Uint8Array(await blob.arrayBuffer());
          // Convert bytes → base64 in chunks to avoid call-stack overflow on
          // large images. (Avatars are 512x512 JPEGs at q=0.8 — typically
          // 30–80 KB, so this is safe in one pass, but the chunked path is
          // robust for any future format changes.)
          let binary = "";
          const CHUNK = 0x8000;
          for (let i = 0; i < buf.length; i += CHUNK) {
            binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
          }
          avatarDataUri = `data:image/jpeg;base64,${btoa(binary)}`;
        }
      }
    } catch (_e) {
      avatarDataUri = null;
    }
```

- [ ] **Step 3: Update the `buildCard3x5Pdf` call to pass the new option.**

Find the existing call (a single arg today):

```ts
    const pdfBytes = await buildCard3x5Pdf(cardData);
```

Replace with:

```ts
    const pdfBytes = await buildCard3x5Pdf(cardData, { avatarDataUri });
```

(Variable names — `pdfBytes`, `cardData` — match what's actually in the file. The `opts` param is optional so passing `{ avatarDataUri: null }` is also valid and produces the existing behavior.)

- [ ] **Step 4: Deploy the edge function.**

```bash
npx supabase functions deploy create-share-package
```

Expected: success message naming the deployed function. Confirm with `npx supabase functions list` that the deploy completed.

- [ ] **Step 5: Commit.**

```bash
git add supabase/functions/create-share-package/index.ts
git commit -m "create-share-package: embed avatar on card_3x5 PDFs

Reads user_profiles.avatar_path, downloads bytes from the private
profile-pictures bucket via the service role client, base64-encodes
in chunks, and passes as opts.avatarDataUri to buildCard3x5Pdf.

Wrapped in try/catch — a missing or unreadable avatar must never
block share creation. Other share types (full_summary,
pre_visit_note, full_timeline) are unaffected."
```

---

## Task 9: `delete-account` — sweep `profile-pictures/{userId}/` on account deletion

**Files:**
- Modify: `supabase/functions/delete-account/index.ts`

The function already calls `deleteStoragePrefix(admin, "documents", "${userId}/")` to clean up the documents bucket (line 157). Add an analogous call for the new bucket.

- [ ] **Step 1: Find the documents-bucket cleanup line.**

```bash
grep -n "deleteStoragePrefix.*documents" /Users/darwashi/Downloads/rivr/RIVR-Health-AI/supabase/functions/delete-account/index.ts
```

Expected: one line near 157.

- [ ] **Step 2: Add the avatar bucket sweep right after it.**

Find:

```ts
    // 3. Storage: documents bucket — all user files recursively
    //    Covers: medical-documents, medical-images, voice-notes,
    //    processed/{docId}/*, ai/evaluation/*, and any root-level files
    await deleteStoragePrefix(admin, "documents", `${userId}/`);
```

Replace with:

```ts
    // 3. Storage: documents bucket — all user files recursively
    //    Covers: medical-documents, medical-images, voice-notes,
    //    processed/{docId}/*, ai/evaluation/*, and any root-level files
    await deleteStoragePrefix(admin, "documents", `${userId}/`);

    // 3b. Storage: profile-pictures bucket — at most one file per user
    //     ({userId}/avatar.jpg) but we sweep the prefix to be future-proof.
    await deleteStoragePrefix(admin, "profile-pictures", `${userId}/`);
```

- [ ] **Step 3: Deploy the edge function.**

```bash
npx supabase functions deploy delete-account
```

Expected: success.

- [ ] **Step 4: Commit.**

```bash
git add supabase/functions/delete-account/index.ts
git commit -m "delete-account: sweep profile-pictures bucket too

Add an analogous deleteStoragePrefix call for the new
profile-pictures bucket so avatars are cleaned up on account
deletion. At most one file per user today, but sweeping the prefix
is future-proof."
```

---

## Task 10: End-to-end manual smoke test

**Files:** none (manual verification).

Until this passes, do not consider the feature shipped.

- [ ] **Step 1: Confirm Task 1's SQL ran.** Re-run the verification queries from Task 1 Step 2. Bucket exists, four policies exist, `avatar_path` column exists.

- [ ] **Step 2: Confirm both edge functions are deployed.**

```bash
npx supabase functions list
```

Expected: `create-share-package` and `delete-account` both show recent `updated_at`.

- [ ] **Step 3: Start the app.**

```bash
npm run start
```

Open on iOS Simulator, a real device, or the web bundle.

- [ ] **Step 4: Test upload from library.**

Sign in. Open Profile screen. Tap the avatar circle (currently shows your initials). Bottom sheet appears with three options. Tap **Choose from library**. Select a photo. Crop UI appears. Adjust the square crop. Confirm.

Expected:
- A spinner overlays the avatar circle briefly.
- Spinner clears.
- The photo replaces the initials inside the circle. Image is round (clipped by `borderRadius: 9999`).
- No console error.

- [ ] **Step 5: Test upload from camera (skip if testing on web with no camera).**

Tap the avatar again. Tap **Take photo**. Native camera opens. Take a photo. Crop. Confirm.

Expected: same as Step 4 — spinner, then photo updates.

- [ ] **Step 6: Test the photo appears on the Health Summary card preview.**

Navigate to **Health Summary** screen. Scroll to the 3×5 card preview section. A 64×64 round avatar appears to the left of the one-line summary text. Photo matches what you uploaded.

If the user has no `card_json` populated yet (fresh account, no documents processed), the card section may not render at all — that's expected. Process at least one document or save a profile so the card data exists, then return to verify.

- [ ] **Step 7: Test the photo appears on the share PDF.**

Navigate to the **Share** screen. Create a new share of type **3×5 card** (or whichever UI label corresponds to `card_3x5`). Open the share link in a browser, download the PDF.

Expected:
- A small (~0.8 inch) square photo appears in the top-right corner of the card, with a thin border.
- Photo overlaps the teal header band slightly and extends into the white card body — looks like an ID-card photo.
- Other content (BLOOD TYPE, conditions, allergies, etc.) is unchanged.
- Photo matches what you uploaded.

- [ ] **Step 8: Test that other share types still work without a photo.**

Create a **Full Summary** share. Open the PDF. Confirm: no photo anywhere. Layout is unchanged from before this feature.

Repeat with **Pre-Visit Note**.

- [ ] **Step 9: Test removing the photo.**

Back on Profile. Tap avatar circle. Bottom sheet now shows **Remove photo** (third option, only because hasPhoto). Tap it.

Expected:
- Spinner briefly overlays the circle.
- Spinner clears.
- Photo is gone; initials are visible again.
- The Remove option no longer appears in the sheet on the next tap (because hasPhoto is now false).

- [ ] **Step 10: Verify the bucket and column are cleared.**

```sql
-- Run in Supabase dashboard SQL editor
SELECT user_id, avatar_path
FROM public.user_profiles
WHERE user_id = '<your test user_id>';
-- Expected: avatar_path = NULL

SELECT name FROM storage.objects WHERE bucket_id = 'profile-pictures';
-- Expected: zero rows for the deleted user's path
```

- [ ] **Step 11: Test that an existing share PDF (created before removal) is unchanged.**

Re-open the share link from Step 7. The PDF still has the photo embedded — it was baked in at share-creation time and is not retroactively re-rendered. **This is intentional.**

- [ ] **Step 12: Test invalid input handling.**

Tap avatar → Choose from library → cancel out of the picker (back button on iOS). Expected: no error, no change to the avatar.

- [ ] **Step 13 (optional): Test account deletion sweeps the bucket.**

In a **separate test account** (so you don't lose data), upload a photo and then delete the account from the Profile / Settings screen. Verify:

```sql
SELECT name FROM storage.objects
WHERE bucket_id = 'profile-pictures'
  AND name LIKE '<deleted user_id>/%';
-- Expected: zero rows
```

- [ ] **Step 14: Final sanity check.**

Open the worker, the Timeline page, the Manage Documents page, and the Home screen. Confirm nothing related to documents / processing / timeline broke as a side effect of the avatar changes. (This feature touches code paths shared with the document flow — `user_profiles` schema, `delete-account`, `create-share-package` — so a quick smoke of the rest of the app catches any regression.)

---

## Self-Review Notes

- **Spec coverage:** every section of the spec maps to a task — schema (Task 1), `UserProfile` type (Task 2), avatar lib (Task 3), picker sheet (Task 4), ProfileScreen (Task 5), HealthSummaryScreen (Task 6), PDF builder (Task 7), edge function (Task 8), account-deletion sweep (Task 9), end-to-end verification (Task 10).
- **No backfill task:** intentional — there's no existing avatar data to migrate.
- **Type consistency:** `UserProfile.avatar_path` is `string | null` (nullable, optional) in Task 2; `useAvatarUrl` accepts `string | null | undefined` in Task 3; `removeAvatar` accepts `string | null` in Task 3; `buildCard3x5Pdf`'s `opts.avatarDataUri` is `string | null` in Task 7. All compatible.
- **Edge function deploys:** Tasks 8 and 9 both include a `npx supabase functions deploy` step. Without those deploys, the new code in the repo doesn't ship — verify in Task 10 Step 2.
- **PDF backward compat:** Task 7's signature uses an optional second arg, so any future caller of `buildCard3x5Pdf` that doesn't know about avatars keeps working unchanged.
