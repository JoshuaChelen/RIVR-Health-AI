# Document Provenance & Review — Design Spec

**Date:** 2026-06-17
**Status:** Approved (direction); ready for implementation planning
**Scope:** RIVR Health AI — backend (Django/DRF/Celery) + Expo mobile client. Next.js web is a stub and **out of scope**.

---

## 1. Problem

Today, when a user uploads a document, the LLM pipeline extracts health facts (allergies, medications, conditions, surgeries, labs, timeline events) and **silently merges them** into the user's profile, emergency card, and timeline. After processing:

- Processed documents **disappear** from the app (`?exclude_status=processed`). There is no library of past files and no way to re-open the original.
- The user **cannot see what the LLM produced** from a given document — the per-document `summary.json` is never exposed via the API.
- Extracted items carry **no visible provenance** — a user can't tell which document a medication came from, or that it was AI-added at all.
- There is **no way to validate, correct, reject, or cancel** an AI finding, and **no way to re-run** the analysis on a file.

The employer's framing: *"did the summary get it right? where did the LLM obtain this data from? … Does the user need to flag the condition / medication / dosage / allergy / intolerance as incorrect or inaccurate? … which relies on the original files being accessible somewhere."*

## 2. Goals (decided)

1. **Transparency-and-control model (not a gate).** Findings keep auto-populating as today, so the profile is immediately useful. The new layer makes every AI finding **traceable, reviewable, correctable, and reversible after the fact.** *(Brainstorm decision B.)*
2. **Document-level provenance.** Each AI finding is attributable to the source document; tapping it opens the original file to verify. **No change to the LLM extraction prompt/schema.** Designed so citation-level provenance can be layered on later. *(Brainstorm decision 1.)*
3. **Per-item review actions: Confirm / Edit / Reject.** No separate "flagged-but-still-in-profile" state — in a health context a finding the user believes is wrong is removed (reject) or corrected (edit), not left in place with a warning. *(Brainstorm decision: action set.)*
4. **Cancel a document's results = detach, keep the file.** Removes everything that document uniquely contributed, but the document + original stay in the user's library marked "results removed." A separate explicit "delete file" still exists. **Shared findings are protected** (a finding also present in another document or manually entered is not removed). **Re-run respects prior rejections.** *(Brainstorm decision A + defaults.)*
5. **Re-run the LLM** on a single document.
6. **A documents library** where processed files are listed and openable.

### Non-goals (YAGNI)

- Citation/quote/page-level provenance, per-item confidence (phase 2 — schema is designed not to preclude it).
- A pre-merge approval gate (explicitly rejected in favor of B).
- Web client UI.
- A feedback loop that retrains/tunes the model.
- Review of non-backfilled fields (`family_history`, `hospitalizations`, `social_history` are never AI-backfilled, so they need no review surface).

## 3. Key architectural insight

Two facts in the existing code make this feasible with **minimal, surgical change**:

1. **`summary.json` is the immutable record of what the LLM produced per document.** It already contains `key_facts` + `timeline_events` + `confidence_0_to_1`, stored at `documents/{user_id}/processed/{doc_id}/summary.json`.
2. **The suppression engine already canonicalizes items by normalized key** (`allergy_key`, `medication_key`, `med_history_key`, `surgery_key` in `apps/jobs/profile_logic.py`) and tracks AI items via the `ai_` id prefix and `ai_backfill_meta`.

Therefore:

- **Provenance is computed, not stored.** "What document X contributed" = AI items in the profile whose normalized key appears in document X's `summary.json`. "Shared finding" = the same key also appears in another active document's summary **or** a manual (non-`ai_`) item exists with that key. This needs **no new column and no data migration.**
- **Reject reuses suppression.** Rejecting an item = remove it from the profile array; the existing `compute_suppressed_keys` / `filter_doc_facts_by_suppression` machinery already prevents it from resurfacing on re-run/re-eval.
- **The only genuinely new persisted state is per-item review status** (`confirmed` / `edited`) and, for edits, a snapshot of the AI's original value. This is small, lives only on `ai_` items, and must be **server-owned** so the whole-profile `PATCH` can't strip it.

## 4. Data model changes

### 4.1 `Document` (`apps/documents/models.py`)

Add one nullable field (additive migration, no enum churn):

```python
detached_at = models.DateTimeField(null=True, blank=True)
```

- `detached_at IS NULL` → document's results are active (contributes to digest/eval/backfill).
- `detached_at` set → "results removed": excluded from the digest queries in `pipeline._common_tail` and from backfill; file + summary retained; still listed in the library with a "Results removed" pill.
- Re-running a detached document clears `detached_at`.

`status` stays `PROCESSED` for detached docs (we do **not** add a new status value).

### 4.2 AI profile items (`UserProfile` JSON arrays)

AI-backfilled item dicts gain **server-owned** optional fields (only on `ai_`-id items, only on the 4 backfilled fields):

```jsonc
{
  "id": "ai_1a2b…",
  "name": "Metformin", "dose": "1000mg", "frequency": "BID",   // existing
  "review_status": "edited",                // "confirmed" | "edited"; absent = unreviewed
  "reviewed_at": "2026-06-17T…Z",           // set on confirm/edit
  "ai_original": { "name": "Metformin", "dose": "500mg", "frequency": "BID" }  // set on edit only
}
```

- Absence of `review_status` = **unreviewed** (the default state for freshly backfilled items).
- `ai_original` preserves what the LLM said so the UI can show "AI said 500 mg → you corrected to 1000 mg."
- These fields are **ignored by every existing normalizer** (`build_manual_profile_context`, `build_ai_backfilled_context`, `merge_card_with_profile` all read only known keys), so they are inert to the eval pipeline.
- **No provenance field is stored** (see §3).

## 5. Backend changes

### 5.1 Provenance / contributions service (new: `apps/documents/provenance.py`)

Pure functions, reused by endpoints and detach:

- `document_facts_keys(summary_json) -> {field: set[key]}` — normalized keys per backfilled field for one document's facts.
- `compute_contributions(user, document) -> list[ContributionItem]` — for each fact in the doc's `summary.json`, join against the profile arrays + suppressed keys to produce a state:
  - `present` (+ `review_status`: unreviewed/confirmed/edited, + `profile_item_id`, + `ai_original`)
  - `rejected` (key in suppressed set, not in array)
  - `not_added` (deduped / superseded by a manual item — not in array, not suppressed)
- `documents_sharing_key(user, field, key, exclude_doc_id) -> bool` — true if another **active** (`detached_at IS NULL`, `PROCESSED`, non-`manual_input`) document's summary contains that key, **or** a manual item with that key exists. Used by detach to protect shared findings.

Performance: these read `summary.json` from object storage. They run only on detail-view / detach / per-item-source requests (never on list endpoints), and a user's processed-doc count is small. Acceptable as synchronous request work.

### 5.2 Document endpoints (`apps/documents/views.py`)

- `GET /api/documents/{id}/analysis/` — **"what the LLM produced."** Returns `{ confidence_0_to_1, key_facts, timeline_events, contributions: [...] }` parsed from `summary.json` + computed contribution states. `404` if not processed.
- `POST /api/documents/{id}/reprocess/` — re-enqueue a single-document `PROCESS_DOCUMENTS` job. Clears `detached_at`, sets `status=PROCESSING`, calls into `apps/jobs/services.py`. Re-run respects existing suppression (rejected items will not return). Returns the job id.
- `POST /api/documents/{id}/detach/` — **cancel results, keep file.** Within a transaction:
  1. For each AI item whose key matches this doc's facts: remove it **only if** `documents_sharing_key(...)` is false (protect shared/manual). Multi-source items are left in place.
  2. Delete this doc's `TimelineEvent`s (`source="document_ai"`, `document_id=id`).
  3. Set `detached_at = now()`.
  4. **Do not** add removed keys to suppression (detach is reversible; re-run should restore).
  Returns a summary `{ removed: {field: n}, kept_shared: {field: n} }`.
- `GET /api/documents/{id}/file/` — already exists (signed URL to original). Reused by the viewer.
- **Harden `perform_destroy`:** before deleting the row, run the detach removal of unique AI contributions and delete the `summary.json` object from storage (closes the existing orphaned-summary gap). Then delete `pdf_path` + row as today.

`DocumentSerializer` adds `detached_at` (read-only). `DocumentFilter` adds a way to list processed records (`status=processed`) and to distinguish detached.

**`manual_input` is excluded** from all of the above (analysis / reprocess / detach / records library / review). It is the user's own profile snapshot, not an uploaded record — it already round-trips through `upsertManualInputDocument` and has no externally-sourced facts to attribute. The records query and `DocumentDetail` entry points filter it out (`exclude source_type=manual_input`).

### 5.3 Profile AI-item endpoints (new viewset under `apps/profiles/`)

Items are addressed by their unique `ai_` id (the server locates the item across the 4 backfilled arrays):

- `POST /api/profile/ai-items/{item_id}/confirm` — set `review_status="confirmed"`, `reviewed_at=now()`.
- `PATCH /api/profile/ai-items/{item_id}` — edit detail fields (`dose`, `frequency`, `reaction`, `severity`, `year`, `notes`, `status`). On first edit, snapshot `ai_original`; set `review_status="edited"`. Editing a **key field** (name/allergen/condition/procedure) is handled as: suppress the old key, keep the edited item (documented edge case).
- `POST /api/profile/ai-items/{item_id}/reject` — remove the item from its array (suppression then prevents resurfacing). Returns ok.
- `GET /api/profile/ai-items/{item_id}/sources` — computed list `[{document_id, title}]` of active documents whose facts contain this item's key (on-demand, so the profile list render stays cheap).

All are owner-scoped to the JWT user and operate server-side on `UserProfile`.

### 5.4 Harden whole-profile update (`apps/profiles/views.py` `MyProfileView`)

When arrays are written via `PUT/PATCH /api/profile`, **the server re-owns AI-item metadata**: for any incoming item with an `ai_` id matching a stored AI item, restore `review_status` / `reviewed_at` / `ai_original` from the DB copy regardless of what the client sent; for `ai_` items dropped from the array, treat as deletion (existing suppression applies). This guarantees the manual-edit screen can never silently wipe review state.

### 5.5 Backfill provenance accounting (`apps/jobs/`)

No schema change, but the **re-run must restore detached docs**: `_common_tail`'s two digest queries and the backfill gate must filter `detached_at__isnull=True`. (A detached doc that is re-run clears `detached_at` first, so it re-enters naturally.) Also ensure `apps/jobs/services.py` allows re-enqueuing a `PROCESSED` document (today it transitions `UPLOADED → PROCESSING`).

### 5.6 Unreviewed count

Expose `ai_review = { unreviewed: n, total_ai_items: n }` on the health-profile or profile response (computed from the arrays) so the client can show "N AI findings to review."

## 6. Client (Expo) changes

### 6.1 Documents library

`ManageDocumentsScreen` / `ListDocuments`: add a **"Your records"** section listing processed documents (`?status=processed`), each card showing title, date, source type, a "Results removed" pill when `detached_at` is set, and an unreviewed-count chip. Tapping a card → new `DocumentDetail` screen. The existing upload / active-processing / failed flow is unchanged.

### 6.2 `DocumentDetail` screen (new, registered in `AppNavigator` + `appTypes`)

Primary review surface for one document:

- **Header:** title, date, source type; doc-level **confidence** shown honestly (e.g. "AI confidence: 82% — self-reported; verify against the original").
- **View original** button → `GET /documents/{id}/file/` → open the signed URL (PDF/image/audio).
- **What the AI found:** the `analysis` contributions grouped by field (Allergies / Medications / Conditions / Surgeries / Timeline). Each item shows its state badge (Unreviewed / Confirmed / Edited / Rejected / Not added) and, for present items, **Confirm / Edit / Reject** actions. Edited items show "AI said X → you corrected to Y."
- **Footer actions:** **Re-run analysis** (reprocess) and **Cancel results** (detach, with a confirm dialog warning how many findings — incl. any reviewed ones — will be removed and that the file is kept), plus the existing **Delete file**.

### 6.3 Profile / summary surfaces (lightweight)

In `MedicalProfileScreen` (and read-only in `HealthSummaryScreen`'s lists), AI items (`ai_` id) get an **"AI" badge** + an unreviewed indicator, with inline **Confirm / Edit / Reject** and a "source" affordance that calls `…/sources`. This makes the employer's "flag a condition/medication/dosage/allergy/intolerance" possible wherever the user encounters it, while the `DocumentDetail` screen remains the per-document review hub.

### 6.4 API client (`src/lib/api/data.ts`)

Add: `getDocumentAnalysis(id)`, `reprocessDocument(id)`, `detachDocument(id)`, `confirmAiItem(id)`, `editAiItem(id, patch)`, `rejectAiItem(id)`, `getAiItemSources(id)`, and a `listDocuments` records query helper.

## 7. State semantics (reference)

| User action | Profile array | Suppression | Document | Timeline |
|---|---|---|---|---|
| Confirm | `review_status=confirmed` | — | — | — |
| Edit (detail) | fields updated, `ai_original` stashed, `review_status=edited` | — | — | — |
| Reject | item removed | key suppressed (won't resurface) | — | — |
| Cancel results (detach) | unique AI items removed; shared kept | **not** suppressed (reversible) | `detached_at` set, file kept | doc's `document_ai` events deleted |
| Re-run | re-backfilled (suppression honored) | rejections honored | `detached_at` cleared, re-PROCESSED | doc's events rebuilt |
| Delete file | unique AI items removed | — | row + file + summary deleted | events `SET_NULL`/removed |

## 8. Testing

**Backend (pytest):**
- `provenance.compute_contributions`: present/confirmed/edited/rejected/not_added states resolved correctly.
- Detach protects a finding shared with another active doc; removes a unique finding; protects a manual item with the same key; deletes the doc's timeline events; sets `detached_at`; does **not** suppress.
- Re-run a detached doc restores its findings; re-run does **not** resurface a rejected item (suppression honored).
- `MyProfileView` PATCH preserves `review_status`/`ai_original` when the client omits them; dropping an `ai_` item triggers suppression.
- AI-item endpoints: confirm/edit/reject/sources happy paths + ownership scoping (can't touch another user's item).
- `_common_tail` digest excludes `detached_at`-set docs.
- `perform_destroy` removes the summary object and unique AI contributions.

**Client (jest):**
- API client wrappers hit the right routes.
- Contributions → badge-state mapping.
- Detach confirm-dialog copy reflects counts.

## 9. Rollout / safety

- All migrations are additive (`detached_at` nullable; item fields are JSON-optional). No backfill migration required (provenance is computed; legacy AI items simply start as "unreviewed").
- Feature is read-additive: if the new screens were never opened, existing auto-populate behavior is unchanged.
- Pre-launch posture: changes are targeted to documents/profiles/jobs; no refactor of the eval pipeline beyond the `detached_at` filter and the re-run enable.

## 10. Open implementation choices (for the plan, non-blocking)

- Whether "Your records" is a section on `ManageDocumentsScreen` or its own list — UI detail, decide during planning.
- Exact route shape for AI-item endpoints (`/profile/ai-items/{id}/…` vs a single `/profile/review` action) — pick the one that fits existing DRF routing.
- Whether `analysis` and `sources` share a cache on the client.
