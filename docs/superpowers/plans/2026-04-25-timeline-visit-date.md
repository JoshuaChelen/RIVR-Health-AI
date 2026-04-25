# Timeline Visit Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make timeline events show the actual visit date (or "Unknown date" with a prompt to set it), instead of stamping events with the document upload date when the AI extractor cannot find a date in the document.

**Architecture:** Drop `NOT NULL` on `timeline_events.occurred_at` / `date_precision`. Worker stops fabricating a fallback date and writes nulls when the AI returns null; the AI extraction prompt is tightened so the model looks harder for dates anywhere in the document. The Timeline screen renders undated events in an "Unknown date" section pinned to the bottom with a `Set date` button on each card. Tapping it opens a modal that batch-stamps every undated event from that document. Existing per-event edit screen continues to work and is updated to validate partial precision dates.

**Tech Stack:** Expo / React Native 0.7x / TypeScript / `@supabase/supabase-js` (postgrest join syntax). Worker is Node + tsx + OpenAI SDK + Zod. Project has no Jest/Vitest setup, so verification is by manual smoke test plus one ad-hoc tsx script.

**Spec:** `docs/superpowers/specs/2026-04-25-timeline-visit-date-design.md`

---

## File map

**Modify:**
- `worker/src/main.ts` — remove `fallbackDate` variable and parameter; change `replaceDocTimelineEvents` signature; update its caller.
- `worker/src/ai.ts` — replace the `Rules:` block in the `extractDocumentFacts` system prompt.
- `src/components/ui/Timeline/TimelineCard.tsx` — add optional `onSetDate` prop; render `Set date` CTA when provided instead of the date label.
- `src/screens/App/TimelineEventDetailsScreen.tsx` — change date validator from "always YYYY-MM-DD" to per-precision (year / month / day).
- `src/screens/App/TimelineScreen.tsx` — query joins `documents(title)`, sorts with `nullsFirst: false`, splits dated/undated rows, renders an "Unknown date" header + cards with `Set date` CTAs, shows a small banner at top when undated events exist, integrates the new modal.

**Create:**
- `src/components/ui/Timeline/SetVisitDateModal.tsx` — new modal that batch-stamps a date on every undated event for a given `document_id`.

**Operational (not code):**
- Run a one-off SQL command in the Supabase dashboard SQL editor (Task 1).

---

## Task 1: Drop NOT NULL on `timeline_events.occurred_at` and `date_precision`

**Files:**
- Operational only (Supabase dashboard SQL editor). The repo has no `supabase/migrations/` folder; schema is dashboard-managed.

- [ ] **Step 1: Tell the user to run this SQL in the Supabase dashboard SQL editor**

```sql
ALTER TABLE public.timeline_events
  ALTER COLUMN occurred_at    DROP NOT NULL,
  ALTER COLUMN date_precision DROP NOT NULL;
```

This must run **before** the worker change (Task 2) is deployed in production, otherwise the worker's null inserts will fail. During dev, the user can run it any time before testing the new worker locally.

- [ ] **Step 2: Verify**

Have the user run this in the SQL editor and confirm the result has `is_nullable = YES` for both columns:

```sql
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'timeline_events'
  AND column_name IN ('occurred_at', 'date_precision');
```

Expected output:

| column_name      | is_nullable |
|------------------|-------------|
| occurred_at      | YES         |
| date_precision   | YES         |

- [ ] **Step 3: No commit needed** (DB-only change tracked in the spec).

---

## Task 2: Worker — remove upload-date fallback and tighten AI date extraction prompt

**Files:**
- Modify: `worker/src/main.ts`
- Modify: `worker/src/ai.ts`

- [ ] **Step 1: In `worker/src/main.ts`, change the signature of `replaceDocTimelineEvents` (around lines 209–268) to drop the `fallbackDate` parameter.**

Find this:

```ts
async function replaceDocTimelineEvents(
  userId: string,
  docId: string,
  events: any[],
  fallbackDate: string
) {
```

Replace with:

```ts
async function replaceDocTimelineEvents(
  userId: string,
  docId: string,
  events: any[],
) {
```

- [ ] **Step 2: In the same function body, change the per-event normalization to write nulls when no date is found.**

Find this:

```ts
const safeEvents = (events || [])
    .map((ev) => {
      // normalize date but do not drop if missing, DB needs NOT NULL occurred_at
      const normalized = normalizeDate(ev);

      const occurred_at = normalized?.occurred_at ?? fallbackDate;
      const date_precision = normalized?.date_precision ?? "day";
```

Replace with:

```ts
const safeEvents = (events || [])
    .map((ev) => {
      // If no date can be inferred, persist null. The Timeline UI surfaces
      // these as "Unknown date" and lets the user fill them in.
      const normalized = normalizeDate(ev);

      const occurred_at = normalized?.occurred_at ?? null;
      const date_precision = normalized?.date_precision ?? null;
```

- [ ] **Step 3: In the same function's returned object, the two fields stay named the same but are now nullable.**

The existing `return { ... occurred_at, date_precision, ... }` needs no change — the variables are now `string | null` and Postgrest accepts that. Leave the rest of the returned object alone.

- [ ] **Step 4: Delete the `fallbackDate` computation in the document-processing loop (around line 539).**

Find this:

```ts
const fallbackDate = new Date(d.created_at ?? Date.now()).toISOString().slice(0, 10);
```

Delete the line entirely.

- [ ] **Step 5: Update the call site to `replaceDocTimelineEvents` (around line 681) to drop the fourth argument.**

Find this:

```ts
await replaceDocTimelineEvents(
  userId,
  docId,
  Array.isArray(facts.timeline_events) ? facts.timeline_events : [],
  fallbackDate
);
```

Replace with:

```ts
await replaceDocTimelineEvents(
  userId,
  docId,
  Array.isArray(facts.timeline_events) ? facts.timeline_events : [],
);
```

- [ ] **Step 6: In `worker/src/ai.ts`, replace the `Rules:` block of the `extractDocumentFacts` system prompt (lines ~132–139).**

Find this:

```ts
const system = `You extract structured medical facts from ONE document AND produce timeline events.
Rules:
- Only use what is present in the text. If missing, use null or empty arrays.
- Be conservative. Do not guess blood type.
- timeline_events: include only high confidence events (diagnoses, surgeries, lab results, medications).
- occurred_at should be YYYY-MM-DD if present.
- data_kv must always be present. If nothing, return [] (not {})..
Return JSON only in the required schema.`;
```

Replace with:

```ts
const system = `You extract structured medical facts from ONE document AND produce timeline events.
Rules:
- Only use what is present in the text. If missing, use null or empty arrays.
- Be conservative. Do not guess blood type.
- timeline_events: include only high confidence events (diagnoses, surgeries, lab results, medications).
- For occurred_at, look carefully for dates anywhere in the document: visit/encounter dates, signature dates, lab collection/draw dates, prescription dates, discharge dates, headers, footers, and report-generated dates.
- Accept partial dates. Use YYYY-MM-DD when known precisely, YYYY-MM when only month is known, YYYY when only year is known. Set date_precision accordingly ("day" / "month" / "year").
- If no event date can be found in the document, return occurred_at: null and date_precision: null. Do NOT use today's date. Do NOT invent a date.
- data_kv must always be present. If nothing, return [] (not {}).
Return JSON only in the required schema.`;
```

- [ ] **Step 7: Type-check the worker.**

Run from the repo root:

```bash
cd worker && npx tsc --noEmit
```

Expected: no errors. (If the `fallbackDate` variable name was referenced anywhere else and missed, the compiler will flag it — go fix.)

- [ ] **Step 8: Sanity-check that the date normalizer still does the right thing.**

Run this one-off script from the repo root:

```bash
cd worker && npx tsx -e "
const ev1 = { occurred_at: '2024-03-15', date_precision: 'day' };
const ev2 = { occurred_at: '2024-03',    date_precision: 'month' };
const ev3 = { occurred_at: '2024',       date_precision: 'year' };
const ev4 = { occurred_at: null,         date_precision: null };

// Inline the normalizer body so we don't have to export it.
function normalizeDate(ev) {
  const dp = ev?.date_precision;
  const raw = String(ev?.occurred_at ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { occurred_at: raw, date_precision: (dp ?? 'day') };
  if (/^\d{4}-\d{2}$/.test(raw))       return { occurred_at: raw + '-01', date_precision: 'month' };
  if (/^\d{4}$/.test(raw))             return { occurred_at: raw + '-01-01', date_precision: 'year' };
  return null;
}
console.log(normalizeDate(ev1));
console.log(normalizeDate(ev2));
console.log(normalizeDate(ev3));
console.log(normalizeDate(ev4));
"
```

Expected output:

```
{ occurred_at: '2024-03-15', date_precision: 'day' }
{ occurred_at: '2024-03-01', date_precision: 'month' }
{ occurred_at: '2024-01-01', date_precision: 'year' }
null
```

- [ ] **Step 9: Commit.**

```bash
git add worker/src/main.ts worker/src/ai.ts
git commit -m "worker: stop stamping timeline events with upload date

The AI extractor's schema already permits null occurred_at /
date_precision for events the model cannot date. Previously the
worker fell back to the document's created_at (the upload date),
which is wrong — it shows medical events as having happened the
day they were added to RIVR.

This change drops the fallback (now persists null) and tightens
the extraction prompt so the model looks harder for dates in
headers, signatures, lab/prescription/discharge fields, and is
explicitly told never to use today's date or invent one.

Requires the timeline_events.occurred_at / date_precision NOT NULL
constraints to be dropped (see migration in spec).
"
```

---

## Task 3: TimelineCard — accept optional `onSetDate` prop

**Files:**
- Modify: `src/components/ui/Timeline/TimelineCard.tsx`

- [ ] **Step 1: Add `onSetDate` to `TimelineCardProps`.**

Find:

```ts
type TimelineCardProps = {
  title: string;
  dateLabel: string;
  category: string;
  source?: string;
  summary: string;
  included: boolean;
  onToggleIncluded: (next: boolean) => void;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};
```

Replace with:

```ts
type TimelineCardProps = {
  title: string;
  dateLabel: string;
  category: string;
  source?: string;
  summary: string;
  included: boolean;
  onToggleIncluded: (next: boolean) => void;
  onPress?: () => void;
  /**
   * When provided, the card replaces the static `dateLabel` slot with a
   * tappable "Set date" CTA. Used for events whose occurred_at is null.
   */
  onSetDate?: () => void;
  style?: StyleProp<ViewStyle>;
};
```

- [ ] **Step 2: Destructure the new prop.**

Find:

```ts
export function TimelineCard({
  title,
  dateLabel,
  category,
  source,
  summary,
  included,
  onToggleIncluded,
  onPress,
  style,
}: TimelineCardProps) {
```

Replace with:

```ts
export function TimelineCard({
  title,
  dateLabel,
  category,
  source,
  summary,
  included,
  onToggleIncluded,
  onPress,
  onSetDate,
  style,
}: TimelineCardProps) {
```

- [ ] **Step 3: Render the `Set date` CTA when `onSetDate` is provided, else render the existing `dateLabel`.**

Find:

```tsx
          <AppText style={styles.date}>{dateLabel}</AppText>
        </View>
```

Replace with:

```tsx
          {onSetDate ? (
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Set visit date"
              onPress={onSetDate}
              hitSlop={6}
              style={({ pressed }) => [styles.setDateBtn, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="calendar-outline" size={12} color={colors.teal} />
              <AppText style={styles.setDateBtnText}>Set date</AppText>
            </Pressable>
          ) : (
            <AppText style={styles.date}>{dateLabel}</AppText>
          )}
        </View>
```

- [ ] **Step 4: Add the two new style entries inside the `useStyles` block (right after the `date:` entry).**

Find:

```ts
  date: {
    fontSize: typescale.size.xs,
    color: c.teal,
    fontWeight: typescale.weight.semibold,
    flexShrink: 0,
    paddingTop: 2,
  },
```

Add directly below it (still inside the same `StyleSheet.create({...})` object):

```ts
  setDateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: c.tealSoft,
    borderWidth: 1,
    borderColor: c.tealBorder,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexShrink: 0,
  },
  setDateBtnText: {
    fontSize: typescale.size.xs,
    color: c.teal,
    fontWeight: typescale.weight.bold,
  },
```

- [ ] **Step 5: TypeScript check.**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add src/components/ui/Timeline/TimelineCard.tsx
git commit -m "TimelineCard: add optional onSetDate prop

When provided, the card renders a 'Set date' pill button instead of
the static date label. Used for timeline events whose occurred_at
is null."
```

---

## Task 4: TimelineEventDetailsScreen — accept partial-precision dates and normalize on save

**Files:**
- Modify: `src/screens/App/TimelineEventDetailsScreen.tsx`

The current validator (line 143) accepts only `YYYY-MM-DD`. After Task 5, the per-document modal writes events with partial precision and stores the canonical full date (`2024-03` becomes `2024-03-01` on disk; `2024` becomes `2024-01-01`). Either form is valid input on this screen — the user might type the partial form ("I only know the month"), or they might leave the canonical form they see in the field after a fresh load. Validator must accept both, and the payload must always be the canonical form.

- [ ] **Step 1: Replace the validator with a per-precision check that accepts both partial and canonical forms.**

Find:

```ts
    if (draft.occurred_at.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(draft.occurred_at.trim())) {
      setErr("Date must be in YYYY-MM-DD format.");
      return;
    }
```

Replace with:

```ts
    // Validate against the selected precision. Accept either the canonical
    // YYYY-MM-DD form (what the DB stores) or the partial form matching the
    // precision pill (what the user might type). Both are fine.
    let normalizedOccurredAt: string | null = null;
    {
      const v = draft.occurred_at.trim();
      if (v) {
        const acceptable: Record<"day" | "month" | "year", RegExp[]> = {
          day:   [/^\d{4}-\d{2}-\d{2}$/],
          month: [/^\d{4}-\d{2}$/,  /^\d{4}-\d{2}-\d{2}$/],
          year:  [/^\d{4}$/,        /^\d{4}-\d{2}-\d{2}$/],
        };
        if (!acceptable[draft.date_precision].some((re) => re.test(v))) {
          setErr(
            draft.date_precision === "year"  ? "Date must be in YYYY or YYYY-MM-DD format." :
            draft.date_precision === "month" ? "Date must be in YYYY-MM or YYYY-MM-DD format." :
                                               "Date must be in YYYY-MM-DD format."
          );
          return;
        }
        // Normalize partial input to canonical YYYY-MM-DD for storage.
        normalizedOccurredAt =
          /^\d{4}$/.test(v)             ? `${v}-01-01` :
          /^\d{4}-\d{2}$/.test(v)       ? `${v}-01`    :
                                          v;
      }
    }
```

- [ ] **Step 2: Use the normalized value in the payload.**

Find:

```ts
    const payload: Partial<TimelineEventRow> = {
      title:          draft.title.trim() || null,
      summary:        draft.summary.trim() || null,
      occurred_at:    draft.occurred_at.trim() || null,
      date_precision: draft.date_precision,
      category:       draft.category.trim() || null,
      event_type:     draft.event_type.trim() || null,
      tags,
    };
```

Replace with:

```ts
    const payload: Partial<TimelineEventRow> = {
      title:          draft.title.trim() || null,
      summary:        draft.summary.trim() || null,
      occurred_at:    normalizedOccurredAt,
      date_precision: draft.date_precision,
      category:       draft.category.trim() || null,
      event_type:     draft.event_type.trim() || null,
      tags,
    };
```

- [ ] **Step 3: TypeScript check.**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add src/screens/App/TimelineEventDetailsScreen.tsx
git commit -m "TimelineEventDetailsScreen: accept partial-precision dates

Previously the validator only accepted YYYY-MM-DD even when the
precision pill was Month or Year. With the new per-document Set
date modal writing month/year precision events, this screen needs
to accept both the canonical YYYY-MM-DD form (what the DB stores)
and the partial form (what the user might type). On save, partial
forms are normalized to canonical before sending to Postgrest so
the date column accepts them."
```

---

## Task 5: SetVisitDateModal — new modal for batch-stamping a document's undated events

**Files:**
- Create: `src/components/ui/Timeline/SetVisitDateModal.tsx`

- [ ] **Step 1: Create the file with the full component.**

Write to `src/components/ui/Timeline/SetVisitDateModal.tsx`:

```tsx
import React, { useState } from "react";
import {
  Modal,
  View,
  StyleSheet,
  SafeAreaView,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { supabase } from "../../../lib/supabase";
import { captureException } from "../../../lib/sentry";
import { AppText } from "../Primitives/AppText";
import { TextField } from "../Primitives/TextField";
import { PrimaryButton } from "../Primitives/PrimaryButton";
import { GhostButton } from "../Primitives/GhostButton";
import { spacing, radius, typescale, shadows } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useTheme } from "../../../context/ThemeContext";

type Precision = "day" | "month" | "year";

type Props = {
  visible: boolean;
  documentId: string;
  documentTitle: string;
  undatedEventCount: number;
  onSaved: () => void;
  onClose: () => void;
};

const PRECISIONS: ReadonlyArray<{ key: Precision; label: string; hint: string; pattern: RegExp }> = [
  { key: "day",   label: "Day",   hint: "YYYY-MM-DD",  pattern: /^\d{4}-\d{2}-\d{2}$/ },
  { key: "month", label: "Month", hint: "YYYY-MM",     pattern: /^\d{4}-\d{2}$/ },
  { key: "year",  label: "Year",  hint: "YYYY",        pattern: /^\d{4}$/ },
];

export function SetVisitDateModal({
  visible,
  documentId,
  documentTitle,
  undatedEventCount,
  onSaved,
  onClose,
}: Props) {
  const styles = useStyles();
  const { colors } = useTheme();

  const [value, setValue]         = useState("");
  const [precision, setPrecision] = useState<Precision>("day");
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const reset = () => {
    setValue("");
    setPrecision("day");
    setSaving(false);
    setErr(null);
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleSave = async () => {
    setErr(null);
    const trimmed = value.trim();
    const def = PRECISIONS.find((p) => p.key === precision)!;
    if (!def.pattern.test(trimmed)) {
      setErr(`Date must be in ${def.hint} format.`);
      return;
    }

    // Normalize to YYYY-MM-DD for storage (DB column is a date — DDL of the
    // table always stores a full day even for month / year precision).
    const occurred_at =
      precision === "day"
        ? trimmed
        : precision === "month"
        ? `${trimmed}-01`
        : `${trimmed}-01-01`;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("timeline_events")
        .update({ occurred_at, date_precision: precision })
        .eq("document_id", documentId)
        .is("occurred_at", null);

      if (error) throw error;

      reset();
      onSaved();
      onClose();
    } catch (e: any) {
      captureException(e);
      setErr(e?.message ?? "Failed to save date.");
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <SafeAreaView style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <AppText style={styles.title}>When was this visit?</AppText>
              <AppText style={styles.subtitle} numberOfLines={2}>
                {documentTitle}
              </AppText>
              <AppText style={styles.count}>
                Will date {undatedEventCount} undated event
                {undatedEventCount === 1 ? "" : "s"} from this document.
              </AppText>
            </View>
            <Pressable
              onPress={handleClose}
              disabled={saving}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
              hitSlop={10}
            >
              <Ionicons name="close" size={18} color={colors.muted} />
            </Pressable>
          </View>

          {/* Precision pills */}
          <View style={styles.pillRow}>
            {PRECISIONS.map((p) => {
              const active = precision === p.key;
              return (
                <Pressable
                  key={p.key}
                  onPress={() => {
                    setPrecision(p.key);
                    setErr(null);
                  }}
                  disabled={saving}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`Precision ${p.label}`}
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.pill,
                    active && styles.pillActive,
                    pressed && !saving && { opacity: 0.8 },
                  ]}
                >
                  <AppText style={[styles.pillText, active && styles.pillTextActive]}>
                    {p.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          {/* Date input */}
          <TextField
            label="Visit date"
            value={value}
            onChangeText={(t) => {
              setValue(t);
              setErr(null);
            }}
            placeholder={PRECISIONS.find((p) => p.key === precision)!.hint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            editable={!saving}
          />
          <AppText style={styles.hint}>
            Format: {PRECISIONS.find((p) => p.key === precision)!.hint}. Set as close as
            you remember; you can leave events undated if you don't know.
          </AppText>

          {err ? (
            <AppText style={styles.error}>{err}</AppText>
          ) : null}

          {/* Actions */}
          <View style={styles.actions}>
            {saving ? (
              <View style={styles.savingRow}>
                <ActivityIndicator color={colors.teal} size="small" />
                <AppText style={styles.savingText}>Saving…</AppText>
              </View>
            ) : (
              <>
                <PrimaryButton label="Save date" onPress={handleSave} tone="teal" />
                <GhostButton label="Skip for now" onPress={handleClose} />
              </>
            )}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = createStyles((c) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: c.bg,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
      gap: spacing.md,
      ...shadows.card,
    },

    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    title: {
      fontSize: typescale.size.lg,
      fontWeight: typescale.weight.bold,
      color: c.text,
    },
    subtitle: {
      fontSize: typescale.size.sm,
      color: c.textSub,
      marginTop: 2,
    },
    count: {
      fontSize: typescale.size.xs,
      color: c.muted,
      marginTop: spacing.xxs,
    },
    closeBtn: {
      width: 30,
      height: 30,
      borderRadius: radius.pill,
      backgroundColor: c.bgSecondary,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },

    pillRow: {
      flexDirection: "row",
      gap: spacing.xs,
    },
    pill: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    pillActive: {
      backgroundColor: c.tealSoft,
      borderColor: c.tealBorder,
    },
    pillText: {
      fontSize: typescale.size.sm,
      fontWeight: typescale.weight.semibold,
      color: c.muted,
    },
    pillTextActive: {
      color: c.teal,
    },

    hint: {
      fontSize: typescale.size.xs,
      color: c.muted,
    },
    error: {
      fontSize: typescale.size.sm,
      color: c.danger,
      fontWeight: typescale.weight.medium,
    },

    actions: {
      gap: spacing.xs,
      marginTop: spacing.sm,
    },
    savingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      height: 48,
    },
    savingText: {
      fontSize: typescale.size.sm,
      color: c.teal,
      fontWeight: typescale.weight.semibold,
    },
  }),
);
```

- [ ] **Step 2: TypeScript check.**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add src/components/ui/Timeline/SetVisitDateModal.tsx
git commit -m "add SetVisitDateModal for stamping undated timeline events

Bottom-sheet modal scoped to a single document. The user picks a
precision (Day/Month/Year), enters a date in the corresponding
format, and the modal updates every undated timeline_event rows
for that document_id in one query. Skip simply closes."
```

---

## Task 6: TimelineScreen — query joins, null-aware sort, "Unknown date" section, banner, modal integration

**Files:**
- Modify: `src/screens/App/TimelineScreen.tsx`

This is the biggest task. It's broken into eight steps so each one is reviewable in isolation. Commit at the end.

- [ ] **Step 1: Update imports and types.**

Find the import block at the top:

```ts
import React, { useMemo, useState, useCallback, useRef } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
```

Replace with (no other imports — `useRef` was already imported):

```ts
import React, { useMemo, useState, useCallback, useRef } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
import { SetVisitDateModal } from "../../components/ui/Timeline/SetVisitDateModal";
```

Then find the type block:

```ts
type DatePrecision = "day" | "month" | "year";

type TimelineEventRow = {
  id: string;
  occurred_at: string;
  date_precision: DatePrecision;
  title: string;
  event_type: string;
  category: string;
  source: string;
  summary: string;
  included_in_previsit: boolean;
};

type RenderRow =
  | { kind: "month"; key: string; label: string }
  | { kind: "event"; key: string; event: TimelineEventRow; isLastInGroup: boolean };
```

Replace with:

```ts
type DatePrecision = "day" | "month" | "year";

type TimelineEventRow = {
  id: string;
  occurred_at: string | null;
  date_precision: DatePrecision | null;
  title: string;
  event_type: string;
  category: string;
  source: string;
  summary: string;
  included_in_previsit: boolean;
  document_id: string | null;
  documentTitle: string | null;
};

type RenderRow =
  | { kind: "month"; key: string; label: string }
  | { kind: "unknownHeader"; key: string }
  | { kind: "event"; key: string; event: TimelineEventRow; isLastInGroup: boolean };
```

- [ ] **Step 2: Update the Supabase query in `load` to join `documents(title)`, sort with NULLS LAST, and map the joined row.**

Find:

```ts
  const load = useCallback(async (offset = 0, append = false) => {
    if (!append) setErr(null);
    try {
      const { data, error } = await supabase
        .from("timeline_events")
        .select(
          "id, occurred_at, date_precision, title, event_type, category, source, summary, included_in_previsit"
        )
        .neq("source", "apple_health")
        .order("occurred_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) throw error;

      const filtered = ((data ?? []) as TimelineEventRow[]).filter(
        (e) => e.source !== "apple_health"
      );

      setHasMore(filtered.length === PAGE_SIZE);

      if (append) {
        setEvents((prev) => [...prev, ...filtered]);
      } else {
        setEvents(filtered);
      }
```

Replace with:

```ts
  const load = useCallback(async (offset = 0, append = false) => {
    if (!append) setErr(null);
    try {
      const { data, error } = await supabase
        .from("timeline_events")
        .select(
          "id, occurred_at, date_precision, title, event_type, category, source, summary, included_in_previsit, document_id, documents(title)"
        )
        .neq("source", "apple_health")
        .order("occurred_at", { ascending: false, nullsFirst: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) throw error;

      type RawRow = Omit<TimelineEventRow, "documentTitle"> & {
        documents: { title: string | null } | { title: string | null }[] | null;
      };

      const rows = ((data ?? []) as unknown as RawRow[])
        .filter((e) => e.source !== "apple_health")
        .map<TimelineEventRow>((e) => {
          // Postgrest may return the join as a single object or as a 1-element
          // array depending on the relationship metadata. Handle both shapes.
          const doc = Array.isArray(e.documents) ? e.documents[0] : e.documents;
          const documentTitle = doc?.title ?? null;
          return {
            id: e.id,
            occurred_at: e.occurred_at,
            date_precision: e.date_precision,
            title: e.title,
            event_type: e.event_type,
            category: e.category,
            source: e.source,
            summary: e.summary,
            included_in_previsit: e.included_in_previsit,
            document_id: e.document_id,
            documentTitle,
          };
        });

      setHasMore(rows.length === PAGE_SIZE);

      if (append) {
        setEvents((prev) => [...prev, ...rows]);
      } else {
        setEvents(rows);
      }
```

The closing braces / `catch` / `finally` block stays the same.

- [ ] **Step 3: Add modal state and a FlatList ref, and add helpers to identify undated events.**

Right after the existing `useState` calls (after `const [err, setErr] = useState<string | null>(null);`), add:

```ts
  const flatListRef = useRef<FlatList<RenderRow>>(null);

  const [modalDoc, setModalDoc] = useState<{
    documentId: string;
    documentTitle: string;
    count: number;
  } | null>(null);
```

- [ ] **Step 4: Update the `rows` memo to split dated events from undated ones and emit an `unknownHeader` row.**

Find:

```ts
  const rows: RenderRow[] = useMemo(() => {
    const out: RenderRow[] = [];
    let lastMonthKey: string | null = null;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const monthKey = monthBucketKey(ev.occurred_at, ev.date_precision);
      if (monthKey !== lastMonthKey) {
        out.push({ kind: "month", key: `m-${monthKey}`, label: monthDividerLabel(ev.occurred_at, ev.date_precision) });
        lastMonthKey = monthKey;
      }

      // isLastInGroup = next row is a month divider or we're at the end
      const next = events[i + 1];
      const isLastInGroup = !next || monthBucketKey(next.occurred_at, next.date_precision) !== monthKey;

      out.push({ kind: "event", key: `e-${ev.id}`, event: ev, isLastInGroup });
    }

    return out;
  }, [events]);
```

Replace with:

```ts
  const rows: RenderRow[] = useMemo(() => {
    const out: RenderRow[] = [];
    const dated   = events.filter((e) => !!e.occurred_at && !!e.date_precision);
    const undated = events.filter((e) =>  !e.occurred_at ||  !e.date_precision);

    // Dated rows with month dividers.
    let lastMonthKey: string | null = null;
    for (let i = 0; i < dated.length; i++) {
      const ev = dated[i];
      const monthKey = monthBucketKey(ev.occurred_at!, ev.date_precision!);
      if (monthKey !== lastMonthKey) {
        out.push({
          kind: "month",
          key: `m-${monthKey}`,
          label: monthDividerLabel(ev.occurred_at!, ev.date_precision!),
        });
        lastMonthKey = monthKey;
      }

      const next = dated[i + 1];
      const isLastInGroup =
        !next ||
        monthBucketKey(next.occurred_at!, next.date_precision!) !== monthKey;

      out.push({ kind: "event", key: `e-${ev.id}`, event: ev, isLastInGroup });
    }

    // Unknown-date section pinned at the bottom.
    if (undated.length > 0) {
      out.push({ kind: "unknownHeader", key: "unknown-header" });
      for (let i = 0; i < undated.length; i++) {
        const ev = undated[i];
        out.push({
          kind: "event",
          key: `e-${ev.id}`,
          event: ev,
          isLastInGroup: i === undated.length - 1,
        });
      }
    }

    return out;
  }, [events]);

  const undatedCount = useMemo(
    () => events.filter((e) => !e.occurred_at || !e.date_precision).length,
    [events],
  );

  const unknownHeaderIndex = useMemo(
    () => rows.findIndex((r) => r.kind === "unknownHeader"),
    [rows],
  );

  /**
   * Return how many undated events currently belong to the same document_id
   * as the given event. Used to populate the modal's count line.
   */
  const undatedCountForDoc = useCallback(
    (documentId: string) =>
      events.filter(
        (e) =>
          e.document_id === documentId &&
          (!e.occurred_at || !e.date_precision),
      ).length,
    [events],
  );

  const openSetDate = useCallback(
    (event: TimelineEventRow) => {
      if (!event.document_id) return;
      setModalDoc({
        documentId:    event.document_id,
        documentTitle: event.documentTitle ?? "Document",
        count:         undatedCountForDoc(event.document_id),
      });
    },
    [undatedCountForDoc],
  );
```

- [ ] **Step 5: Update `renderItem` to handle `unknownHeader` and pass `onSetDate` to undated cards.**

Find:

```ts
  const renderItem = useCallback(({ item: row }: { item: RenderRow }) => {
    if (row.kind === "month") {
      return <MonthDivider label={row.label} style={styles.monthDivider} />;
    }

    const ev   = row.event;
    const meta = categoryMeta(ev.category, colors);

    return (
      <View style={styles.spineRow}>
        <View style={styles.spineGutter}>
          <View
            style={[
              styles.spineMarker,
              { backgroundColor: `${meta.dot}14`, borderColor: `${meta.dot}40` },
            ]}
          >
            <View style={[styles.spineMarkerInner, { backgroundColor: meta.dot }]} />
          </View>
          {!row.isLastInGroup ? <View style={styles.spineLine} /> : null}
        </View>
        <TimelineCard
          title={ev.title}
          dateLabel={formatEventDate(ev.occurred_at, ev.date_precision)}
          category={ev.category}
          source={ev.source}
          summary={ev.summary}
          included={ev.included_in_previsit}
          onToggleIncluded={(next) => onToggleIncluded(ev.id, next)}
          onPress={() => navigation.navigate("Details", { id: ev.id })}
          style={styles.card}
        />
      </View>
    );
  }, [navigation, onToggleIncluded, styles, colors]);
```

Replace with:

```ts
  const renderItem = useCallback(({ item: row }: { item: RenderRow }) => {
    if (row.kind === "month") {
      return <MonthDivider label={row.label} style={styles.monthDivider} />;
    }

    if (row.kind === "unknownHeader") {
      return (
        <View style={styles.unknownHeaderWrap}>
          <View style={styles.unknownHeaderBadge}>
            <AppText style={styles.unknownHeaderBadgeText}>Unknown date</AppText>
          </View>
          <View style={styles.unknownHeaderLine} />
        </View>
      );
    }

    const ev      = row.event;
    const meta    = categoryMeta(ev.category, colors);
    const undated = !ev.occurred_at || !ev.date_precision;

    return (
      <View style={styles.spineRow}>
        <View style={styles.spineGutter}>
          <View
            style={[
              styles.spineMarker,
              { backgroundColor: `${meta.dot}14`, borderColor: `${meta.dot}40` },
            ]}
          >
            <View style={[styles.spineMarkerInner, { backgroundColor: meta.dot }]} />
          </View>
          {!row.isLastInGroup ? <View style={styles.spineLine} /> : null}
        </View>
        <TimelineCard
          title={ev.title}
          dateLabel={
            undated ? "Date unknown" : formatEventDate(ev.occurred_at!, ev.date_precision!)
          }
          category={ev.category}
          source={ev.source}
          summary={ev.summary}
          included={ev.included_in_previsit}
          onToggleIncluded={(next) => onToggleIncluded(ev.id, next)}
          onPress={() => navigation.navigate("Details", { id: ev.id })}
          onSetDate={undated && ev.document_id ? () => openSetDate(ev) : undefined}
          style={styles.card}
        />
      </View>
    );
  }, [navigation, onToggleIncluded, openSetDate, styles, colors]);
```

- [ ] **Step 6: Add the inline banner to `listHeader` when `undatedCount > 0`.**

Find:

```ts
  const listHeader = useMemo(() => (
    err ? (
      <View style={{ marginHorizontal: spacing.lg, marginTop: spacing.md }}>
        <ErrorBanner message="Couldn't load your timeline" onRetry={() => load()} />
      </View>
    ) : null
  ), [err, load]);
```

Replace with:

```ts
  const scrollToUnknown = useCallback(() => {
    if (unknownHeaderIndex < 0) return;
    flatListRef.current?.scrollToIndex({
      index:    unknownHeaderIndex,
      animated: true,
      viewPosition: 0,
    });
  }, [unknownHeaderIndex]);

  const listHeader = useMemo(() => (
    <>
      {err ? (
        <View style={{ marginHorizontal: spacing.lg, marginTop: spacing.md }}>
          <ErrorBanner message="Couldn't load your timeline" onRetry={() => load()} />
        </View>
      ) : null}

      {undatedCount > 0 ? (
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel={`${undatedCount} events need a date. Tap to scroll to them.`}
          onPress={scrollToUnknown}
          style={({ pressed }) => [styles.undatedBanner, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.undatedBannerIcon}>
            <Ionicons name="calendar-outline" size={16} color={colors.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText style={styles.undatedBannerTitle}>
              {undatedCount} event{undatedCount === 1 ? "" : "s"} need a date
            </AppText>
            <AppText style={styles.undatedBannerSub}>
              Tap to set the visit date so they appear in order.
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.teal} />
        </Pressable>
      ) : null}
    </>
  ), [err, load, undatedCount, scrollToUnknown, styles, colors]);
```

This step references `Ionicons`, which is not imported in the file yet. Add this import near the existing import block (alongside the other Ionicons usages — but there's no existing one; check by searching the file):

```ts
import Ionicons from "@expo/vector-icons/Ionicons";
```

Note: `Ionicons` *is* already imported in the existing file (line 23). Skip this if the import is already there.

- [ ] **Step 7: Mount the `SetVisitDateModal` and use the FlatList ref.**

Find the return statement:

```tsx
  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      onEndReached={loadMore}
      onEndReachedThreshold={0.3}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={colors.teal}
        />
      }
      ListHeaderComponent={listHeader}
      ListEmptyComponent={listEmpty}
      ListFooterComponent={listFooter}
    />
  );
}
```

Replace with:

```tsx
  return (
    <>
      <FlatList
        ref={flatListRef}
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.teal}
          />
        }
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={listFooter}
        onScrollToIndexFailed={(info) => {
          // Fallback when the row hasn't been measured yet (e.g. unknown
          // section is below the viewport at first paint). Scroll to a
          // best-effort offset, then retry the precise scroll.
          flatListRef.current?.scrollToOffset({
            offset:   info.averageItemLength * info.index,
            animated: true,
          });
          setTimeout(() => {
            flatListRef.current?.scrollToIndex({
              index:    info.index,
              animated: true,
              viewPosition: 0,
            });
          }, 250);
        }}
      />

      {modalDoc ? (
        <SetVisitDateModal
          visible
          documentId={modalDoc.documentId}
          documentTitle={modalDoc.documentTitle}
          undatedEventCount={modalDoc.count}
          onSaved={() => {
            setHasMore(true);
            load(0, false);
          }}
          onClose={() => setModalDoc(null)}
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 8: Add the new styles. Find the `useStyles` block at the bottom of the file and add these entries to the StyleSheet object (any place inside `StyleSheet.create({...})` is fine; convention is to place them near related entries).**

Add these inside the existing `StyleSheet.create({...})` body:

```ts
  // Undated banner
  undatedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: c.tealSoft,
    borderWidth: 1,
    borderColor: c.tealBorder,
    borderRadius: radius.md,
  },
  undatedBannerIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: c.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  undatedBannerTitle: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.bold,
    color: c.teal,
  },
  undatedBannerSub: {
    fontSize: typescale.size.xs,
    color: c.teal,
    opacity: 0.85,
    marginTop: 1,
  },

  // Unknown-date section header (appears once, between dated and undated rows)
  unknownHeaderWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  unknownHeaderBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: c.bgSecondary,
    borderWidth: 1,
    borderColor: c.border,
    flexShrink: 0,
  },
  unknownHeaderBadgeText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: c.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  unknownHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: c.borderLight,
  },
```

- [ ] **Step 9: TypeScript check.**

```bash
npx tsc --noEmit
```

Expected: no errors. Common pitfalls to fix if errors appear:
- The `RawRow` mapping cast `as unknown as RawRow[]` is required because postgrest's generated types don't carry the `documents(title)` join shape — leave the cast as-is.
- If `nullsFirst` is flagged as unknown, your `@supabase/supabase-js` is older than v2.10. Run `npx tsc --noEmit` first; if this comes up, upgrade or use `.order("occurred_at", { ascending: false })` and instead client-sort undated to the end (less efficient but workable).

- [ ] **Step 10: Commit.**

```bash
git add src/screens/App/TimelineScreen.tsx
git commit -m "TimelineScreen: render undated events with Set date prompts

- Query joins documents(title) so the modal can label which visit
  it is asking about.
- Sort uses nullsFirst:false so undated rows fall to the bottom in
  DESC order.
- rows memo splits dated/undated and emits an Unknown date header
  between them; undated cards render a Set date CTA via the new
  TimelineCard.onSetDate prop.
- Inline banner at the top counts undated events and scrolls to
  the unknown section.
- Tapping Set date opens SetVisitDateModal, which batch-stamps every
  null-date event for that document_id."
```

---

## Task 7: Manual smoke test (whole flow, end-to-end)

**Files:** none (manual verification).

This is the final gate. Until this passes, do not merge.

- [ ] **Step 1: Confirm the schema migration ran.** Re-run the verification query from Task 1 Step 2. Both columns must be `is_nullable: YES`.

- [ ] **Step 2: Start the worker.**

```bash
cd worker && npm run dev
```

Expected: worker starts, polling logs appear roughly every 1.5s.

- [ ] **Step 3: Start the app.**

In a second terminal:

```bash
npm run start
```

Open on iOS Simulator or device.

- [ ] **Step 4: Test "AI extracts a date" path (no regression).**

Upload a PDF that has a clearly visible visit date (a discharge summary or visit summary works well).

Wait for processing to finish. Open Timeline. Expected: events show with the AI-extracted date, **not** today's date and **not** in the unknown section. This proves we didn't break the happy path.

- [ ] **Step 5: Test "AI fails to find a date" path (the bug we're fixing).**

Record a short voice note describing a doctor's visit *without saying any date* ("I went to my cardiologist and they said my blood pressure looks fine"). Wait for processing. Open Timeline.

Expected:
- Banner at top: *"N events need a date"*.
- Tap the banner → list scrolls to the "Unknown date" section.
- Each event card in that section shows a **Set date** pill where the date label normally is.
- Card label reads "Date unknown".

- [ ] **Step 6: Test the modal save flow.**

Tap **Set date** on one of the undated cards. Modal slides up. Verify:
- Title says "When was this visit?"
- Subtitle shows the document title (the voice note's title).
- Count line says "Will date N undated events from this document."
- Three precision pills (Day / Month / Year) — Day is selected.

Type `2024-03-15`, tap **Save date**.

Expected: modal closes, list refreshes, the events now appear in the dated section under March 2024 with `Mar 15, 2024` as the label.

- [ ] **Step 7: Test partial precision.**

Re-run Step 5 (record another undated voice note). On the modal, tap **Month**, type `2024-03`, tap **Save date**. Expected: events now show as "March 2024" in the dated section.

Then tap **Year**, type `2024`, save (on a third undated event). Expected: events show as "2024".

- [ ] **Step 8: Test Skip.**

Record another undated voice note, open the modal, tap **Skip for now**. Modal closes. Events remain in the unknown-date section. Banner still shows the count.

- [ ] **Step 9: Test the per-event edit path with partial dates.**

Open the details screen on one of the events you stamped with month precision in Step 7. Verify:
- The precision pill is **Month**.
- The date input shows the canonical full form (e.g. `2024-03-01`) — that is what the DB stores.
- Tap **Save** without making any changes. Expected: success, no validation error. (This is the case Task 4 fixed — the old validator would have rejected the canonical form when precision was Month.)
- Now clear the input and type just `2024-03`, tap **Save**. Expected: success. The Timeline label still reads "March 2024" (Task 4 normalizes partial → canonical before sending).
- Repeat for an event with year precision: input field shows `2024-01-01`, save works; clearing and typing `2024` also saves.

- [ ] **Step 10: Test invalid input.**

Open the modal, leave the field empty, tap **Save date**. Expected: red error "Date must be in YYYY-MM-DD format." (or matching the selected precision). Modal stays open.

Type `garbage`, tap **Save date**. Expected: same validation error.

- [ ] **Step 11: Confirm pre-existing wrong-dated events were not touched** (per spec "leave existing data alone"). Open Timeline. Any events that existed before this change should still be at the same dates they had — wrong but unchanged.

- [ ] **Step 12: Commit a release note** (optional, only if your workflow uses one — otherwise skip).

---

## Self-Review Notes

- **Spec coverage:** every section of the spec maps to a task — schema (Task 1), worker (Task 2), TimelineCard prop (Task 3), per-event validator (Task 4), modal (Task 5), TimelineScreen (Task 6), and end-to-end verification (Task 7).
- **No backfill task:** intentional, per spec ("Leave alone (Section A)").
- **No upload-time picker task:** intentional, per spec non-goal.
- **Type consistency:** `TimelineEventRow.occurred_at` and `date_precision` change from non-null to nullable in Task 6, Step 1 — and every consumer in the file is updated to handle null in Step 4 and Step 5 (using `!` non-null asserts only after a runtime null check).
- **Modal write query:** `.is("occurred_at", null)` is the only safe filter that prevents accidentally overwriting a date the user previously set on a single event via the per-event edit screen.
