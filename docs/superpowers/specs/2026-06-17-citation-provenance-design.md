# Citation-Level Provenance — Design Spec (Phase 2B)

**Date:** 2026-06-17
**Status:** Approved; ready for implementation planning
**Scope:** RIVR Health AI — backend (extraction + verification) + Expo client. Phase 2B of the document provenance/review work (2A = intolerance, done).

---

## 1. Problem / Goal

Phase 1 gave document-level provenance ("this came from *Blood Panel.pdf*"). The employer's deeper question — *"where did the LLM obtain this data from? how accurate?"* — wants the **exact evidence**: the verbatim text the finding was pulled from, plus a per-finding confidence. This spec adds, per reviewable extracted item, a **verified source quote** and a **per-item confidence**, surfaced on the document review screen.

## 2. Decided approach (brainstorm)

- **Form:** verbatim `source_quote` + per-item `confidence_0_to_1` (decision 1). Not page numbers (the pipeline concatenates text-layer pages without page markers, so page numbers are unreliable) and not char-offset highlighting (needs an in-app highlight viewer — out of scope).
- **Trust:** **verify and only keep a quote that appears in the source text** (decision A). A quote not provably in the document is dropped (the finding still shows its confidence). Honest evidence over decorative quotes.
- **Reach:** only the four *reviewable* item types — allergies, medications, conditions, surgeries_procedures. (Labs, implants, timeline are not user-reviewed; out of scope.)

### Non-goals
- Page numbers, char-offset/highlight anchors, in-app PDF highlighting.
- Citations on labs/implants/timeline/extra_notes.
- Storing the quote/confidence on profile items (they live per-document in `summary.json`; provenance is about *what the document said*, not the user's current value) — so backfill, suppression, the card, and shares are untouched.
- Re-confidence on the health evaluation or 3×5 card.

## 3. Backend

### 3.1 Schema (`apps/jobs/schemas.py`)
Add to `Allergy`, `Medication`, `Condition`, `SurgeryProcedure`:
```python
    source_quote: Optional[str] = None
    confidence_0_to_1: Optional[float] = Field(default=None, ge=0, le=1)
```
(`DocumentFacts.confidence_0_to_1` — the document-level one — stays; these are per-item and independently optional.)

### 3.2 Extraction prompt (`apps/jobs/ai_client.py` `_EXTRACT_SYSTEM`)
Add a rule: *for each allergy/medication/condition/surgery, include `source_quote` = the exact verbatim text from the document it was extracted from (copy it character-for-character; do NOT paraphrase; use null if there is no exact supporting text), and `confidence_0_to_1` = your 0–1 confidence that the extraction is correct.*

### 3.3 Verification (`apps/jobs/citations.py` — new)
A pure, testable function:
```python
def verify_quotes(key_facts: dict, text: str) -> dict:
    """Null out any source_quote not provably present in `text` (normalized
    whitespace + case). Confidence is left untouched. Returns key_facts."""
```
Normalization: lowercase + collapse runs of whitespace, on both the document text and each quote; substring test. Applies to the four reviewable lists only. Robust to empty/missing text (then all quotes are nulled — nothing is provable).

### 3.4 Pipeline integration (`apps/jobs/pipeline.py` `_process_one_document`)
After extraction + the existing `normalize_units` loops and **before** `_write_json(_summary_key(...), facts)`:
```python
    facts["key_facts"] = citations.verify_quotes(facts.get("key_facts", {}), text)
```
Only on the real-extraction path (the no-`pdf_path` stub already writes empty key_facts — no change). `text` there is the document text (or the voice-note transcript).

### 3.5 Threading — no change needed
`provenance.compute_contributions` already returns each fact's raw item dict as `contribution["fact"]`; with the schema change that dict now carries `source_quote` + `confidence_0_to_1`, so the `analysis` endpoint surfaces them automatically. **No provenance, backfill, suppression, card, or endpoint changes.**

## 4. Client (Expo)

### 4.1 Confidence helper (`src/lib/documentReview.ts`)
```typescript
export function confidenceChip(v?: number | null): { label: string; tone: "ok" | "warn" } | null {
  if (typeof v !== "number") return null;
  const pct = Math.round(v * 100);
  return { label: `${pct}% confident`, tone: v < 0.5 ? "warn" : "ok" };
}
```

### 4.2 DocumentDetail (`src/screens/App/DocumentDetailScreen.tsx`)
Extend the `Contribution.fact` usage: under each finding, render
- the **source quote** when `fact.source_quote` is a non-empty string — small italic, quoted (e.g. *"…Metformin 500 mg PO BID…"*);
- a **confidence chip** when `confidenceChip(fact.confidence_0_to_1)` is non-null (amber tone when `< 0.5`).
Both are read-only and only render when present. "View original file" remains.

### 4.3 No other screens
Medical Profile / Health Summary unchanged — citations are a per-document review feature.

## 5. Testing

**Backend (pytest):**
- Schema accepts `source_quote` + `confidence_0_to_1` and defaults them to None; `confidence_0_to_1` rejects out-of-range.
- `verify_quotes`: keeps a quote that appears (including a case/whitespace-normalized match), nulls one that doesn't, nulls all when text is empty, leaves confidence untouched, and only touches the four reviewable lists.
- Pipeline: after processing, the stored `summary.json` keeps only verified quotes (integration-style test of `verify_quotes` wiring, or assert on the function called with the doc text).
- `analysis` endpoint contribution `fact` includes `source_quote` + `confidence_0_to_1`.

**Client (vitest):**
- `confidenceChip`: returns null for non-number; `% confident` label; `warn` tone below 0.5, `ok` at/above.

## 6. Rollout
Additive/non-breaking. Existing `summary.json` files lack the new fields → those documents show no quotes/per-item confidence until the user **re-runs** the analysis (existing reprocess action); newly processed documents include them. No mass re-processing, no migration.
