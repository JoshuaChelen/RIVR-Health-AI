# Profile picture for ER triage identity verification

Date: 2026-04-29
Status: Design approved (sections 1–5)
Branch: `audit`

## Problem

A patient brought to the ER hands the triage nurse a RIVR share link or PDF
containing their 3×5 emergency card. The card today is text-only — blood
type, allergies, conditions, current meds, anesthesia notes, emergency
contact. There is no visual layer that lets the receiving provider confirm
*the document belongs to the person in front of them*. A face photo on the
card is the same affordance a hospital wristband or driver's license
provides; without it the card is "useful information about someone."

## Goals

- Let users upload, change, and remove a profile photo from inside the app.
- Embed that photo on the 3×5 emergency-card PDF that providers receive
  through a share link, so the receiving clinician can match the card to
  the patient at a glance.
- Treat the photo as PHI: private storage, RLS, signed URLs, no public bucket.

## Non-goals

- Photo on share types other than `card_3x5` (full summary, pre-visit note,
  full timeline). Out of scope for this spec; can be added later if there's
  user feedback for it.
- Photo on the share-web preview page (`share.rivrhealth.ai`). The static
  page only links to the PDFs; the PDF is where the photo lives.
- Photo on the Home screen, app navigation chrome, or any avatar slot
  outside ProfileScreen and HealthSummaryScreen.
- Retroactive re-rendering of existing share PDFs. A PDF is a static
  artifact at the moment of share creation; a later photo change does
  not propagate to in-flight shares.
- Backfill of any existing data (no existing photos to migrate).

## Approach

Five coordinated pieces:

1. **DB**: one new nullable column `user_profiles.avatar_path` storing the
   Storage object key (e.g. `{user_id}/avatar.jpg`).
2. **Storage**: a new private bucket `profile-pictures` with RLS scoped to
   `auth.uid()`. The PDF builder uses the service role client to read across
   users (it already does for documents).
3. **App library `src/lib/avatar.ts`**: single source of truth for upload
   (resize + JPEG re-encode, upload, patch profile), remove (delete object,
   clear column), and read (signed URL with auto-refresh).
4. **App UI**: ProfileScreen avatar circle becomes interactive (tap to
   show a bottom-sheet with Take photo / Choose from library / Remove
   photo). HealthSummaryScreen shows a small ID-badge avatar at the top
   of the 3×5 card preview.
5. **Share PDF**: `create-share-package` for `card_3x5` looks up the
   avatar, downloads bytes, base64-encodes, and passes to
   `buildCard3x5Pdf` which renders a ~0.8" square in the top-right corner.

## Detailed design

### 1. Database

One-shot SQL run in the Supabase dashboard SQL editor:

```sql
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS avatar_path text;
```

Existing RLS on `user_profiles` (rows scoped by `user_id = auth.uid()`)
automatically protects the column. No new policies on the table itself.

### 2. Storage bucket

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-pictures', 'profile-pictures', false)
ON CONFLICT (id) DO NOTHING;

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

The `(storage.foldername(name))[1]` predicate matches the first path segment
to the requesting user's `auth.uid`. Path layout: `{user_id}/avatar.jpg`.
At most one file per user.

### 3. App library `src/lib/avatar.ts`

New file. Three exports:

```ts
import { supabase } from "./supabase";
import { upsertProfile } from "./profile";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

const BUCKET = "profile-pictures";
const SIGNED_URL_TTL_S = 600; // 10 min
const AVATAR_DIM = 512;
const JPEG_QUALITY = 0.8;

export async function uploadAvatar(userId: string, sourceUri: string): Promise<string> {
  // Re-encode strips EXIF/GPS as a side effect; resizes to a square.
  const manipulated = await manipulateAsync(
    sourceUri,
    [{ resize: { width: AVATAR_DIM, height: AVATAR_DIM } }],
    { compress: JPEG_QUALITY, format: SaveFormat.JPEG },
  );

  const path = `${userId}/avatar.jpg`;
  const blob = await (await fetch(manipulated.uri)).blob();

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (uploadErr) throw uploadErr;

  await upsertProfile(userId, { avatar_path: path });
  return path;
}

export async function removeAvatar(userId: string, currentPath: string | null): Promise<void> {
  if (currentPath) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([currentPath]);
    if (rmErr) throw rmErr;
  }
  await upsertProfile(userId, { avatar_path: null });
}

export function useAvatarUrl(avatarPath: string | null | undefined): string | null {
  // Hook: maintains a signed URL state, refreshes ~1 min before TTL expires.
  // Returns null when avatarPath is null. Implementation: useState +
  // useEffect that signs on mount and on path change, sets a setTimeout to
  // re-sign 60 s before expiry, cleans up on unmount or path change.
  // Concrete code in the implementation plan.
}
```

`UserProfile` type in `src/lib/profile.ts` gets `avatar_path?: string | null`.

### 4. App UI

#### ProfileScreen avatar circle (`src/screens/App/ProfileScreen.tsx:326-327`)

Wrap the existing `avatarCircle` in a `Pressable` that opens a bottom-sheet
modal with three buttons:

- **Take photo** → `ImagePicker.requestCameraPermissionsAsync()` →
  `ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1,1], quality: 0.9 })`
- **Choose from library** → permission request → `launchImageLibraryAsync(...)` with
  the same options.
- **Remove photo** — only rendered when `userProfile.avatar_path` is non-null.

On any non-cancelled selection: call `uploadAvatar(userId, asset.uri)` (or
`removeAvatar`), refetch `userProfile`, render the new signed URL inside
the same `avatarCircle`. While loading, show a small `ActivityIndicator`
overlaid on the circle. On error, show an inline error message under the
avatar.

The `<Image>` is rendered on top of the existing initials fallback so when
the URL is loading, the user still sees their initials — no flash to a
blank circle.

The bottom-sheet visual style matches the `DuplicateConfirmModal`
introduced for the upload flow: translucent backdrop, bottom-anchored
sheet with a teal accent bar.

#### HealthSummaryScreen 3×5 card preview (`src/screens/App/HealthSummaryScreen.tsx`)

Inside the existing card section (the block that renders `card.major_conditions`,
`card.allergies`, `card.one_line_summary`, etc.) — at the top of the
section, render a row with a 64×64 round avatar to the left and the
`one_line_summary` (or patient name if available) to the right. When
`avatar_path` is null, the row is just text — no avatar slot.

Avatar uses the same `useAvatarUrl(userProfile.avatar_path)` hook.

### 5. Share PDF

#### `supabase/functions/create-share-package/index.ts`

When the share `file_type` is `card_3x5`, before calling `buildCard3x5Pdf`:

```ts
let avatarDataUri: string | null = null;
if (cardOnlyShare /* i.e. file_type === "card_3x5" */) {
  // Best-effort: a missing/failed avatar must never block the share.
  try {
    const { data: prof } = await admin
      .from("user_profiles")
      .select("avatar_path")
      .eq("user_id", userId)
      .maybeSingle();
    const path = (prof as any)?.avatar_path as string | null | undefined;
    if (path) {
      const { data: blob, error: dlErr } = await admin.storage
        .from("profile-pictures")
        .download(path);
      if (!dlErr && blob) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        const b64 = base64FromBytes(buf); // existing helper or inline
        avatarDataUri = `data:image/jpeg;base64,${b64}`;
      }
    }
  } catch (_e) {
    // Swallow — we'll just render the card without a photo.
  }
}

const pdfBytes = await buildCard3x5Pdf(cardData, { avatarDataUri });
```

#### `supabase/functions/_shared/pdf-builders.ts buildCard3x5Pdf`

Extend the signature:

```ts
export async function buildCard3x5Pdf(
  cardData: any,
  opts?: { avatarDataUri?: string | null },
): Promise<Uint8Array>
```

When `opts.avatarDataUri` is non-null:

- Decode the base64 portion of the data URI.
- Use the PDF library's `embedJpg` / `drawImage` (whatever it currently
  exposes — looking at existing PDF code uses pdf-lib).
- Place the image as a 0.8 inch (`~57.6pt`) square in the **top-right
  corner** of the card layout, inset 0.15 inch from the right and top
  edges, with a 1 pt black-with-low-opacity border.
- The `one_line_summary` and patient name flow to the left of it.

When `opts.avatarDataUri` is null (no photo, or download failed): the
existing layout renders unchanged.

### 6. Account deletion

`supabase/functions/delete-account/index.ts` already deletes the user's
storage prefix from every bucket it knows about. Add `profile-pictures` to
that bucket list so avatars are cleaned up on account deletion. One-line
addition to an array.

## Risks and mitigations

- **PHI exposure if RLS is mis-configured.** The four storage policies all
  use the same `(storage.foldername(name))[1] = auth.uid()::text` predicate
  so a user can only touch files under their own prefix. The bucket is
  `public: false`, so even unsigned URLs require authentication. Signed
  URLs are 10 min TTL — long enough for a typical screen session, short
  enough to limit the blast radius of a leaked URL.
- **Avatar download fails during share creation.** The whole avatar block
  is wrapped in try/catch and falls back to a card without a photo. A
  missing or unreadable avatar must never block the share — the card
  itself still has all the clinically useful text.
- **Existing share PDFs don't update when the user changes their photo.**
  By design — PDFs are static artifacts. New shares pick up the new photo;
  existing in-flight shares retain whatever was baked in. Acceptable.
- **HEIC images from iPhone library.** `expo-image-manipulator` accepts
  HEIC and re-encodes to JPEG, so the bucket only ever holds JPEG.
- **EXIF/GPS metadata leak.** Re-encoding through
  `expo-image-manipulator` strips all metadata as a side effect, so the
  uploaded JPEG carries no location, device-ID, or timestamp.

## Operational steps

1. Run the SQL block from Section 1 + 2 in the Supabase dashboard.
2. Verify the bucket exists (`SELECT id, public FROM storage.buckets WHERE
   id='profile-pictures';`) and the four policies are present
   (`SELECT polname FROM pg_policies WHERE tablename='objects' AND polname LIKE 'users %own avatar';`).
3. Deploy the edge function: `npx supabase functions deploy create-share-package`.
4. Deploy the app build (Expo) with the new ProfileScreen + HealthSummary +
   `src/lib/avatar.ts` changes.
5. Smoke test: upload, change, remove a photo. Create a `card_3x5` share.
   Open the resulting PDF and confirm the photo renders top-right.
6. Confirm that `delete-account` properly removes avatars when run against
   a test account.
