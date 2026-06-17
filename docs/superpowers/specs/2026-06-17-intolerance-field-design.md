# Intolerance as a Distinct Category — Design Spec (Phase 2A)

**Date:** 2026-06-17
**Status:** Approved; ready for implementation planning
**Scope:** RIVR Health AI — backend (extraction + profile + eval) + Expo client. Phase 2A of the document provenance/review work; phase 2B (citation-level provenance) is a separate later cycle.

---

## 1. Problem

The employer's list of flaggable items includes both *allergy* and *intolerance*, which are clinically distinct (allergy = immune-mediated, potentially life-threatening; intolerance = non-immune adverse reaction). Today the LLM folds both into a single `allergies` array with no way to tell them apart, and the user can't classify or correct that distinction.

## 2. Goal

Let an allergy entry be marked **allergy** vs **intolerance** — extracted by the LLM when the document says so, settable when adding manually, correctable on AI-extracted items, and shown distinctly in the profile and on the emergency card. Deliver this with **minimal, non-breaking change** by reusing the existing allergies field and all its review/provenance machinery.

## 3. Decided approach

A **`type` subfield on allergy items** (brainstorm decision 1), not a separate `intolerances` array. `type ∈ {"allergy", "intolerance"}`, absent ⇒ `"allergy"`. Both kinds live in the existing `allergies` array, so backfill, provenance, suppression, confirm/edit/reject/undo, the review nudge, and shares all keep working unchanged.

**Identity is unchanged:** the dedup/suppression key stays `allergy_key(substance)` — `type` is a *detail*, not identity. Re-classifying "Penicillin" from allergy→intolerance does not fork it into two items; it edits the one item's `type`.

### Non-goals
- No separate `intolerances` array / model.
- No `ThreeByFiveCard` schema change (the card stays a single allergies line, with intolerances *labeled*).
- No data migration (absent `type` = allergy).
- Phase 2B (citation-level provenance / per-item confidence) is out of scope.

## 4. Backend changes

### 4.1 Extraction schema + prompt (`apps/jobs/`)
- `schemas.py` `Allergy`: add `type: Literal["allergy", "intolerance"] = "allergy"`.
- `ai_client.py` `_EXTRACT_SYSTEM`: add one rule — *"For each allergy entry set `type` to `intolerance` ONLY when the document explicitly indicates a non-allergic intolerance (e.g. 'lactose intolerance', 'food intolerance', 'medication intolerance'); otherwise use `allergy`. Never infer intolerance from an allergy mention."*

### 4.2 Backfill (`apps/jobs/profile_logic.py`)
- `extract_backfill_candidates` allergies block: carry `type` into the new item — `"type": (a.get("type") or "allergy")`. (Default keeps legacy/missing values valid.)
- `AllergyItem` / `NormalizedAllergy` TypedDicts: add optional `type`.
- `build_manual_profile_context` and `build_ai_backfilled_context` allergy normalizers: copy `type` through when present so the eval/card can use it.

### 4.3 Emergency card labeling (`apps/jobs/pipeline.py`)
- `merge_card_with_profile`: when it builds the card's `allergies` line from `manual_ctx`/profile, format each as `allergen` + `" (intolerance)"` when `type == "intolerance"`. (It already overrides the card allergies from the profile context; this just appends the label.) No card-schema change.

### 4.4 Review edit (`apps/profiles/ai_item_views.py`)
- `DETAIL_FIELDS["allergies"]`: add `"type"`.
- `AiItemEditView`: validate that an incoming `type` is one of `{"allergy","intolerance"}` (else 400), so a free-text/garbage value can't be stored.
- Confirm/reject/undo/sources need no change (they operate on the item by id).

## 5. Client changes (Expo)

### 5.1 Types
- `src/lib/profileMedical.ts` `AllergyItem`: add `type?: "allergy" | "intolerance"`.

### 5.2 Medical Profile (`src/screens/App/MedicalProfileScreen.tsx`)
- **Add form:** a `TYPE_OPTS = ["Allergy", "Intolerance"]` `OptionPills` selector (mirrors the existing Severity pills); the manual-add item objects include `type` (lowercased; default `"allergy"`).
- **Display:** allergy rows whose `type === "intolerance"` show a small **"Intolerance"** badge (reuse the row/badge styling).
- **AI item Edit:** `type` is an editable field. Render it as a 2-option toggle, not a free-text input.

### 5.3 Edit sheet — option-field support (`DocumentDetailScreen.tsx` + `MedicalProfileScreen.tsx` `AiItemControls`)
The edit sheets currently render every editable field as a `TextInput`. Add a small per-field **options** map: a field with options renders as `OptionPills`/a toggle instead of a `TextInput`. For allergies, `type → ["allergy","intolerance"]`. (Severity may optionally adopt the same, but that's not required for this feature.) This keeps `type` correction clean and prevents invalid values.

### 5.4 Health Summary
No change — it renders the now-labeled `card_json.allergies` from the backend.

## 6. Testing

**Backend (pytest):**
- `Allergy` schema accepts and defaults `type`; an extracted intolerance round-trips.
- `extract_backfill_candidates` carries `type` onto the backfilled allergy item; missing `type` defaults to `"allergy"`.
- `merge_card_with_profile` appends "(intolerance)" for intolerance items and leaves allergies unlabeled.
- `AiItemEditView` accepts `type` in {allergy,intolerance}; rejects an invalid value with 400; editing `type` does not change `allergy_key` identity (the item is the same row).

**Client (vitest):**
- `AllergyItem` type compiles with `type`.
- Add-form builds an item with the selected `type`.
- (Pure helper if extracted) badge/label logic maps `type` → "Intolerance" label.

## 7. Rollout
Fully additive and non-breaking: existing allergy items (no `type`) read as allergies; no migration. No new env, no new endpoints. The extraction prompt change only affects newly processed documents; existing documents keep their current (allergy-typed) extractions until re-run.
