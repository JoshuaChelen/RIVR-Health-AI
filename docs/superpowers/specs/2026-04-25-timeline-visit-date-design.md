# Timeline event date — visit date, not upload date

Date: 2026-04-25
Status: Design approved (sections 1–4)
Branch: `audit`

## Problem

Timeline events on the home Timeline view currently display the date the source document was uploaded to RIVR, not the date of the actual visit to the doctor or caregiver. Concretely:

- `worker/src/main.ts:539` computes `fallbackDate = new Date(document.created_at).toISOString().slice(0,10)` — the document's upload day.
- `worker/src/main.ts:227` applies that fallback whenever the AI extractor returns `occurred_at: null` (i.e. it could not find a date in the document).
- The DB column `timeline_events.occurred_at` is currently `NOT NULL`, so the worker has nowhere to record "unknown" — it must invent something.
- `TimelineScreen` sorts by `occurred_at DESC`, so wrong-dated events cluster at "today" and out-order older real events.

Worst-affected flows: voice notes (almost never contain an explicit date) and photo scans (OCR misses dates in headers/footers). PDFs with prominent visit-date headers usually extract correctly.

## Goals

- Timeline event dates reflect the actual date of the medical event, not the upload date.
- When neither the AI nor the user knows the date, surface that honestly as "Unknown date" rather than a wrong fallback.
- Light-touch UX: do not add friction at upload time; only prompt the user for a date when one is genuinely missing, on the Timeline screen they're already looking at.

## Non-goals

- No date picker added to the upload sheet (`UploadFile.tsx`, `RecordVoiceNote.tsx`).
- No backfill of existing timeline events with wrong upload-date stamps. Pre-launch (`audit` branch) posture: leave existing data alone; user can fix individual events via the existing `TimelineEventDetailsScreen` if desired.
- No reprocessing of already-processed documents.

## Approach

Four coordinated changes:

1. **Schema**: drop `NOT NULL` on `timeline_events.occurred_at` and `date_precision` so the worker can persist "unknown".
2. **Worker**: stop substituting upload date when the AI returns null. Tighten the AI prompt to look harder for dates anywhere in the document and to never invent one.
3. **Timeline screen**: include null-dated events in the query, sort them to the bottom, render them under an "Unknown date" section with a `Set date` button on each card. Add a small inline banner at the top when undated events exist.
4. **New per-document date modal**: tapping `Set date` opens a sheet scoped to the *document* the event came from, with a date input + day/month/year precision toggle. Saving applies the date to all undated events from that document. Skipping leaves them untouched.

Per-event editing on the existing `TimelineEventDetailsScreen` continues to work as the fine-tuning escape hatch.

## Detailed design

### 1. Database

One-shot SQL run in the Supabase dashboard SQL editor (no `supabase/migrations/` folder is checked in; schema is dashboard-managed):

```sql
ALTER TABLE public.timeline_events
  ALTER COLUMN occurred_at    DROP NOT NULL,
  ALTER COLUMN date_precision DROP NOT NULL;
```

RLS, indexes, foreign keys, and the `source` column are unaffected. Existing rows are not modified.

### 2. Worker

#### `worker/src/main.ts`

Three small edits in the document-processing path:

- **Around line 539**: delete the `fallbackDate` computation entirely.
- **`replaceDocTimelineEvents` (lines ~209–268)**: remove the `fallbackDate: string` parameter. In the `.map(...)` body, when `normalizeDate(ev)` returns `null`, persist `occurred_at: null, date_precision: null`. Drop the inline comment that says *"DB needs NOT NULL occurred_at"* — no longer true. Keep all other normalization (title fallback, event_type/category defaults, tags array, data jsonb).
- **Around line 681**: update the call site to `replaceDocTimelineEvents(userId, docId, facts.timeline_events)` — drop the fourth argument.

The Zod schema in `worker/src/schemas.ts` already permits `occurred_at: z.string().nullable()` and `date_precision: ... .nullable()`, so no schema change is needed there.

#### `worker/src/ai.ts`

Replace the `Rules:` block in the `extractDocumentFacts` system prompt (lines ~132–139) with:

```
Rules:
- Only use what is present in the text. If missing, use null or empty arrays.
- Be conservative. Do not guess blood type.
- timeline_events: include only high confidence events (diagnoses, surgeries, lab results, medications).
- For occurred_at, look carefully for dates anywhere in the document: visit/encounter dates, signature dates, lab collection/draw dates, prescription dates, discharge dates, headers, footers, and report-generated dates.
- Accept partial dates. Use YYYY-MM-DD when known precisely, YYYY-MM when only month is known, YYYY when only year is known. Set date_precision accordingly ("day" / "month" / "year").
- If no event date can be found in the document, return occurred_at: null and date_precision: null. Do NOT use today's date. Do NOT invent a date.
- data_kv must always be present. If nothing, return [] (not {}).
Return JSON only in the required schema.
```

### 3. App / Timeline screen

#### `src/screens/App/TimelineScreen.tsx`

- **Type**: extend `TimelineEventRow` with `document_id: string | null` and `documentTitle: string | null`. Make `occurred_at` and `date_precision` nullable in the type.
- **Query** (around line 61): add `document_id, documents:documents(title)` to the select. Change the order chain to `.order("occurred_at", { ascending: false, nullsFirst: false })` so undated rows fall to the bottom in DESC order.
- **`rows` memo** (around line 107): split events into `dated` and `undated`. Build the existing month-divider grouping for `dated`. After the last dated row, push an `{ kind: "unknownHeader" }` row, then each undated event as a regular `event` row (with a marker that triggers the `Set date` CTA in the card).
- **`listHeader`** (around line 183): when `events.some(e => !e.occurred_at)`, show a small inline banner — *"N event(s) need a date"* with a tappable area that scrolls the FlatList to the unknown section (use `flatListRef.scrollToIndex` against the index of the `unknownHeader` row).
- **`onSetDate` handler**: opens the new `SetVisitDateModal` with `documentId`, `documentTitle`, and the count of currently-undated events for that document. On save, refresh the list with `load()`.

#### `src/components/ui/Timeline/TimelineCard.tsx`

Add an optional prop:

```ts
onSetDate?: () => void;
```

When provided, the card replaces the date label slot with a `Set date` CTA pressable styled as an action button (existing teal token + small chevron). When omitted, the card renders the date label exactly as it does today. This keeps dated cards visually identical.

#### `src/screens/App/TimelineEventDetailsScreen.tsx` — small validation update

Line 143 currently validates only `YYYY-MM-DD`. To stay consistent with partial-precision dates written by the new modal, change the validator to a small per-precision check:

- precision `day` → require `^\d{4}-\d{2}-\d{2}$`
- precision `month` → require `^\d{4}-\d{2}$`
- precision `year` → require `^\d{4}$`
- empty input → null (already supported)

No other change to that screen.

#### New file `src/components/ui/Timeline/SetVisitDateModal.tsx`

A `Modal` (matching the pattern used in `UploadFile.tsx`'s `ScanModal`). Props:

```ts
type Props = {
  documentId: string;
  documentTitle: string;
  undatedEventCount: number;
  onSaved: () => void;
  onClose: () => void;
};
```

Body:

- Heading: *"When was this visit?"*
- Subheading: document title and *"This will date N event(s) from this document."*
- Date text input — accepts `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`. Inline format hint shown beneath the field.
- Precision pill row — `Day` / `Month` / `Year` (visual pattern from `TimelineEventDetailsScreen.tsx:339`). Selecting a precision validates the input format matches.
- Two buttons: **Save** (primary, teal) and **Skip** (ghost). Skip simply calls `onClose`.

Save logic — single Supabase update guarded by RLS:

```ts
const { error } = await supabase
  .from("timeline_events")
  .update({ occurred_at, date_precision })
  .eq("document_id", documentId)
  .is("occurred_at", null);
if (error) { /* show inline error, keep modal open */ return; }
onSaved();
onClose();
```

Validation: input must non-empty match the regex for the selected precision. Reject mismatched precision/format combinations with an inline error before calling the network.

### 4. UX flows

| Scenario | Outcome |
|---|---|
| New doc uploaded, AI extracts a date | Event shows the AI date. No prompt. (Unchanged from today, just no longer at risk of fallback.) |
| New doc uploaded, AI returns null | Event saved with `occurred_at = null`. Appears in "Unknown date" section. Banner shows count at top of Timeline. User taps `Set date`, picks a date in the modal, all undated events from that doc get the date. |
| User skips the modal | Events stay in the "Unknown date" section. They can come back later. |
| User wants to fix a specific event differently than the rest | Tap the card itself → `TimelineEventDetailsScreen` → existing per-event edit. |
| Pre-existing event with wrong upload-date stamp | Untouched. User can fix manually via per-event edit screen if they care. |

## Risks and mitigations

- **AI now legitimately returns null more often → more "Unknown date" events visible to the user.** Mitigation: the tightened prompt gives the model more places to look. Acceptable side effect: users see the truth instead of a fabricated date.
- **The single-update query (`document_id = X AND occurred_at IS NULL`) updates *all* undated events from that doc, including any the user has already edited individually since upload.** In practice the user can only have edited an event individually if it had a non-null date (otherwise there was nothing to display to edit). The `IS NULL` filter prevents overwriting any individually-set date.
- **Banner / modal shown on every Timeline visit until user dismisses or fills.** Acceptable — the prompt is the feature. If it's annoying long-term we can add a per-document "Don't ask again" flag, but defer until launch feedback.

## Operational steps for the developer

1. Run the schema SQL (Section 1) in the Supabase dashboard SQL editor.
2. Deploy the worker with the updated `main.ts` and `ai.ts`.
3. Ship the app build (Expo) with the Timeline screen and modal changes.
