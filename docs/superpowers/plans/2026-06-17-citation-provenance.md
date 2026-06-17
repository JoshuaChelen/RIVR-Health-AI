# Citation-Level Provenance (Phase 2B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, per reviewable AI finding, the verbatim source quote it came from (only when provably in the document) plus a per-item confidence, on the DocumentDetail review screen.

**Architecture:** Add optional `source_quote` + `confidence_0_to_1` to the four reviewable extraction item schemas; the model fills them; a pure verifier nulls any quote not found in the document text before `summary.json` is written. Contributions already surface the raw item dict, so the data flows to the client with no provenance/backfill change.

**Tech Stack:** Django/DRF/Celery (backend); Expo RN + TypeScript + vitest (client). Backend tests: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest <args>`. Client: `npx vitest run <file>` and `npm run typecheck` (baseline 0), from repo root.

---

## Reference (current shapes)

- `apps/jobs/schemas.py`: `Allergy(substance, reaction?, severity, type)`, `Medication(name, dose?, frequency?, notes?)`, `Condition(name, status?, notes?)`, `SurgeryProcedure(name, when?, notes?)`. `DocumentFacts.confidence_0_to_1` is document-level (keep).
- `apps/jobs/pipeline.py` `_process_one_document`: `facts = facts_model.model_dump()`, then `normalize_units` loops mutate `facts["key_facts"]["medications"]`/`key_labs_vitals`, then `_write_json(_summary_key(user_id, doc.id), facts)`. `text` is the extracted document text (or transcript). The no-`pdf_path` branch writes empty key_facts (skip).
- `apps/documents/provenance.py` `compute_contributions`: each output has `"fact": fact` (the raw key_facts item) — so new item fields flow through automatically.
- `apps/jobs/profile_logic.py` `norm(s)`: lowercase + collapse whitespace (reusable for verification).
- `src/screens/App/DocumentDetailScreen.tsx`: `Contribution.fact: Record<string, any>`; finding card renders `itemHead` (label + state badge), optional `ai_original` line, then actions.
- `src/lib/documentReview.ts`: existing `badgeForState`, `isActionable` helpers.
- Test mock pattern (`backend/tests/test_pipeline.py`): `mock_ai` fixture sets `extraction.extract_pdf` → text `"diabetic patient notes " * 20`; monkeypatch `ai_client.extract_document_facts` to control facts.

---

## Task 1: Schema + extraction prompt

**Files:**
- Modify: `backend/apps/jobs/schemas.py` (Allergy, Medication, Condition, SurgeryProcedure)
- Modify: `backend/apps/jobs/ai_client.py` (`_EXTRACT_SYSTEM`)
- Test: `backend/tests/test_citations.py` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_citations.py`:
```python
"""Phase 2B: citation-level provenance (source_quote + per-item confidence)."""
import pytest


def test_item_schemas_accept_quote_and_confidence():
    from apps.jobs.schemas import Allergy, Medication, Condition, SurgeryProcedure
    a = Allergy(substance="Penicillin", severity="high", source_quote="allergy: penicillin", confidence_0_to_1=0.9)
    assert a.source_quote == "allergy: penicillin" and a.confidence_0_to_1 == 0.9
    # defaults
    assert Medication(name="Metformin").source_quote is None
    assert Condition(name="Asthma").confidence_0_to_1 is None
    assert SurgeryProcedure(name="Appendectomy").source_quote is None


def test_item_confidence_range_validated():
    from apps.jobs.schemas import Medication
    with pytest.raises(Exception):
        Medication(name="X", confidence_0_to_1=1.5)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_citations.py -v`
Expected: FAIL — fields don't exist.

- [ ] **Step 3: Add the fields to all four item schemas**

In `backend/apps/jobs/schemas.py`, add these two lines to the END of each of `Allergy`, `Medication`, `Condition`, `SurgeryProcedure`:
```python
    source_quote: Optional[str] = None
    confidence_0_to_1: Optional[float] = Field(default=None, ge=0, le=1)
```
(`Field` and `Optional` are already imported at the top of the file.)

- [ ] **Step 4: Add the extraction rule**

In `backend/apps/jobs/ai_client.py`, inside `_EXTRACT_SYSTEM`, add a bullet (after the intolerance rule added in 2A):
```python
- For each allergy, medication, condition, and surgery/procedure, include source_quote = the EXACT verbatim text from the document that this was extracted from (copy it character-for-character; do NOT paraphrase; use null if there is no exact supporting text), and confidence_0_to_1 = your 0..1 confidence that the extraction is correct.
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_citations.py -v`
Expected: PASS (2)

- [ ] **Step 6: Commit**

```bash
git add backend/apps/jobs/schemas.py backend/apps/jobs/ai_client.py backend/tests/test_citations.py
git commit -m "feat(citations): per-item source_quote + confidence schema + prompt"
```

---

## Task 2: Quote verification (`citations.py`)

**Files:**
- Create: `backend/apps/jobs/citations.py`
- Test: `backend/tests/test_citations.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_citations.py`:
```python
def test_verify_quotes_keeps_present_nulls_absent():
    from apps.jobs.citations import verify_quotes
    text = "Patient takes Metformin 500mg PO BID for diabetes. Allergic to Penicillin."
    kf = {
        "medications": [{"name": "Metformin", "source_quote": "Metformin 500mg PO BID", "confidence_0_to_1": 0.8}],
        "allergies": [{"substance": "Latex", "source_quote": "latex allergy", "confidence_0_to_1": 0.4}],
    }
    out = verify_quotes(kf, text)
    assert out["medications"][0]["source_quote"] == "Metformin 500mg PO BID"   # present -> kept
    assert out["medications"][0]["confidence_0_to_1"] == 0.8                    # confidence untouched
    assert out["allergies"][0]["source_quote"] is None                          # absent -> nulled
    assert out["allergies"][0]["confidence_0_to_1"] == 0.4                       # confidence untouched


def test_verify_quotes_normalizes_whitespace_and_case():
    from apps.jobs.citations import verify_quotes
    text = "Diagnosis:   ASTHMA   (mild)"
    kf = {"conditions": [{"name": "Asthma", "source_quote": "asthma (mild)"}]}
    assert verify_quotes(kf, text)["conditions"][0]["source_quote"] == "asthma (mild)"  # matches normalized


def test_verify_quotes_nulls_all_when_text_empty():
    from apps.jobs.citations import verify_quotes
    kf = {"medications": [{"name": "X", "source_quote": "anything"}]}
    assert verify_quotes(kf, "")["medications"][0]["source_quote"] is None


def test_verify_quotes_ignores_non_reviewable_lists():
    from apps.jobs.citations import verify_quotes
    kf = {"key_labs_vitals": [{"name": "HbA1c", "source_quote": "not checked"}]}
    # labs are out of scope — left exactly as-is (function only touches the 4 reviewable lists)
    assert verify_quotes(kf, "some text")["key_labs_vitals"][0]["source_quote"] == "not checked"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_citations.py -k verify -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `citations.py`**

Create `backend/apps/jobs/citations.py`:
```python
"""Verify per-item source quotes against the document text.

A quote is kept only if it actually appears in the source text (normalized
whitespace + case); otherwise it is nulled so the record never shows a quote
that isn't provably in the document. Confidence is never touched.
"""
from .profile_logic import norm

# Only the user-reviewed item lists carry citations.
_REVIEWABLE = ("allergies", "medications", "conditions", "surgeries_procedures")


def verify_quotes(key_facts: dict, text: str) -> dict:
    if not isinstance(key_facts, dict):
        return key_facts
    haystack = norm(text or "")
    for list_name in _REVIEWABLE:
        for item in key_facts.get(list_name) or []:
            if not isinstance(item, dict):
                continue
            quote = item.get("source_quote")
            if quote and (not haystack or norm(quote) not in haystack):
                item["source_quote"] = None
    return key_facts
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_citations.py -v`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/jobs/citations.py backend/tests/test_citations.py
git commit -m "feat(citations): verify_quotes nulls quotes not in source text"
```

---

## Task 3: Wire verification into the pipeline

**Files:**
- Modify: `backend/apps/jobs/pipeline.py` (`_process_one_document`; import)
- Test: `backend/tests/test_pipeline.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_pipeline.py`:
```python
import json as _json


def test_pipeline_verifies_source_quotes(user, mock_ai, monkeypatch):
    # mock_ai sets extract_pdf text to "diabetic patient notes " * 20
    doc = Document.objects.create(user=user, source_type="pdf", status="processing", mime_type="application/pdf")
    doc.pdf_path = default_storage.save(f"documents/{user.id}/q.pdf", ContentFile(b"%PDF-1.4 fake"))
    doc.save()

    def facts_with_quotes(*a, **k):
        return fake_facts(doc.id, key_facts={
            "blood_type": None,
            "allergies": [], "surgeries_procedures": [], "implants_devices": [],
            "key_labs_vitals": [], "extra_notes": [],
            "medications": [{"name": "Metformin", "source_quote": "diabetic patient", "confidence_0_to_1": 0.7}],
            "conditions": [{"name": "Diabetes", "source_quote": "NOT IN THE DOCUMENT", "confidence_0_to_1": 0.6}],
        })
    monkeypatch.setattr(ai_client, "extract_document_facts", facts_with_quotes)

    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id])
    pipeline.run_job(job.id)
    doc.refresh_from_db()
    with default_storage.open(doc.summary_path) as fh:
        kf = _json.loads(fh.read())["key_facts"]
    assert kf["medications"][0]["source_quote"] == "diabetic patient"   # present -> kept
    assert kf["conditions"][0]["source_quote"] is None                  # absent -> nulled
    assert kf["conditions"][0]["confidence_0_to_1"] == 0.6              # confidence preserved
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_pipeline.py::test_pipeline_verifies_source_quotes -v`
Expected: FAIL — conditions quote not nulled (verification not wired).

- [ ] **Step 3: Wire it in**

In `backend/apps/jobs/pipeline.py`, add `citations` to the existing import line:
```python
from . import ai_client, citations, extraction, index, profile_logic
```
In `_process_one_document`, immediately after the two `normalize_units` loops and **before** `_write_json(_summary_key(user_id, doc.id), facts)`:
```python
    facts["key_facts"] = citations.verify_quotes(facts.get("key_facts", {}), text)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_pipeline.py -v`
Expected: PASS (all, no regressions)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/jobs/pipeline.py backend/tests/test_pipeline.py
git commit -m "feat(citations): verify source quotes during document processing"
```

---

## Task 4: Analysis endpoint surfaces citations

**Files:**
- Test: `backend/tests/test_documents_review.py` (append) — verifies the "no threading change needed" claim.

- [ ] **Step 1: Write the failing-or-guard test**

Append to `backend/tests/test_documents_review.py`:
```python
def test_analysis_surfaces_source_quote_and_confidence(client, user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    doc.summary_path = _summary(user.id, doc.id, {"medications": [
        {"name": "Metformin", "source_quote": "Metformin 500mg", "confidence_0_to_1": 0.82}]})
    doc.save()
    resp = client.get(f"/api/documents/{doc.id}/analysis/")
    assert resp.status_code == 200
    med = next(c for c in resp.json()["contributions"] if c["label"] == "Metformin")
    assert med["fact"]["source_quote"] == "Metformin 500mg"
    assert med["fact"]["confidence_0_to_1"] == 0.82
```
(`_summary` helper already exists in this file and spreads extra `key_facts`.)

- [ ] **Step 2: Run it**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_documents_review.py::test_analysis_surfaces_source_quote_and_confidence -v`
Expected: PASS immediately (the contribution `fact` already carries the raw item). If it fails, the threading assumption is wrong — stop and investigate before changing provenance.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_documents_review.py
git commit -m "test(citations): analysis endpoint surfaces quote + confidence"
```

---

## Task 5: Client confidence helper

**Files:**
- Modify: `src/lib/documentReview.ts`
- Test: `src/lib/documentReview.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/lib/documentReview.test.ts`:
```typescript
import { confidenceChip } from "./documentReview";

describe("confidenceChip", () => {
  it("returns null for a non-number", () => {
    expect(confidenceChip(undefined)).toBeNull();
    expect(confidenceChip(null)).toBeNull();
  });
  it("labels a percent and is ok at/above 0.5", () => {
    expect(confidenceChip(0.82)).toEqual({ label: "82% confident", tone: "ok" });
  });
  it("warns below 0.5", () => {
    expect(confidenceChip(0.3)?.tone).toBe("warn");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/documentReview.test.ts`
Expected: FAIL — `confidenceChip` not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/lib/documentReview.ts`:
```typescript
// Per-item confidence -> a small chip; amber (warn) below 0.5, else ok. null when unknown.
export function confidenceChip(v?: number | null): { label: string; tone: "ok" | "warn" } | null {
  if (typeof v !== "number" || Number.isNaN(v)) return null;
  return { label: `${Math.round(v * 100)}% confident`, tone: v < 0.5 ? "warn" : "ok" };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/documentReview.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentReview.ts src/lib/documentReview.test.ts
git commit -m "feat(citations): confidenceChip client helper"
```

---

## Task 6: DocumentDetail renders quote + confidence

**Files:**
- Modify: `src/screens/App/DocumentDetailScreen.tsx`

- [ ] **Step 1: Import the helper**

In `src/screens/App/DocumentDetailScreen.tsx`, extend the documentReview import:
```typescript
import { badgeForState, isActionable, confidenceChip, type ContributionState } from "../../lib/documentReview";
```

- [ ] **Step 2: Render the quote + chip under each finding**

In the finding card, after the `{c.ai_original ? (...) : null}` line and before the actions block, add:
```tsx
                  {c.fact?.source_quote ? (
                    <AppText style={s.quote}>“{c.fact.source_quote}”</AppText>
                  ) : null}
                  {(() => {
                    const chip = confidenceChip(c.fact?.confidence_0_to_1);
                    return chip ? (
                      <View style={[s.confChip, { backgroundColor: toneBg(colors, chip.tone) }]}>
                        <AppText style={[s.confChipText, { color: toneFg(colors, chip.tone) }]}>{chip.label}</AppText>
                      </View>
                    ) : null;
                  })()}
```
(`toneBg`/`toneFg` already exist in this file and map "ok"→teal, "warn"→danger/amber.)

- [ ] **Step 3: Add the styles**

In the `useStyles` `StyleSheet.create({...})`, add (next to `original`):
```typescript
  quote: { color: c.textSub, fontSize: typescale.size.xs, fontStyle: "italic" },
  confChip: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  confChipText: { fontSize: typescale.size.xs, fontWeight: typescale.weight.semibold },
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: 0 `error TS` lines.

- [ ] **Step 5: Commit**

```bash
git add src/screens/App/DocumentDetailScreen.tsx
git commit -m "feat(citations): show source quote + confidence on findings"
```

---

## Task 7: Full verification

- [ ] **Step 1: Backend suite**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest -q`
Expected: all PASS.

- [ ] **Step 2: Client typecheck + tests**

Run: `npx vitest run src/lib/documentReview.test.ts && npm run typecheck`
Expected: vitest PASS; typecheck 0 `error TS` lines.

---

## Self-review checklist

- **Spec §3.1 (schema fields on 4 types):** Task 1. ✓
- **Spec §3.2 (extraction prompt):** Task 1 step 4. ✓
- **Spec §3.3 (citations.py verify_quotes):** Task 2. ✓
- **Spec §3.4 (pipeline integration):** Task 3. ✓
- **Spec §3.5 (threading — no change, surfaced via analysis):** Task 4 (guard test). ✓
- **Spec §4.1 (confidenceChip):** Task 5. ✓
- **Spec §4.2 (DocumentDetail quote + chip):** Task 6. ✓
- **Spec §4.3 / non-goals (no other screens, no backfill/card/profile change):** nothing touches them — verified (only schema, ai_client, citations, pipeline one-liner, documentReview, DocumentDetail). ✓
- **Spec §5 (tests):** Tasks 1–5. ✓
- **Type consistency:** `confidence_0_to_1` per-item (Optional float, ge/le) on all 4 schemas; `verify_quotes(key_facts, text)`; `confidenceChip(v)` → `{label, tone:"ok"|"warn"}`; `source_quote` (snake) everywhere. ✓
- **Reach limited to 4 reviewable lists:** `_REVIEWABLE` in citations.py; schema fields only on the 4 item types. ✓
