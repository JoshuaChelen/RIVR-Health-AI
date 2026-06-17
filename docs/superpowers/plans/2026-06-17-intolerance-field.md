# Intolerance Field (Phase 2A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an allergy entry be classified allergy vs intolerance — extracted by the LLM, settable on manual add, correctable on AI items, shown with a badge, and labeled on the emergency card.

**Architecture:** A non-breaking optional `type: "allergy" | "intolerance"` subfield on items in the existing `allergies` array (absent ⇒ allergy). Identity stays `allergy_key(substance)`. Reuses all existing backfill/provenance/review machinery.

**Tech Stack:** Django/DRF/Celery + pgvector (backend); Expo React Native + TypeScript + vitest (client). Backend tests run as `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest <args>`. Client: `npx vitest run <file>` and `npm run typecheck` (baseline 0 errors), from repo root.

---

## Reference (current shapes)

- `apps/jobs/schemas.py` `Allergy`: `substance: str`, `reaction: Optional[str]`, `severity: Literal["low","medium","high","unknown"]`.
- `apps/jobs/profile_logic.py`: `extract_backfill_candidates` builds allergy items `{id, allergen, reaction, severity}`; `build_manual_profile_context` / `build_ai_backfilled_context` normalize allergies to `{allergen, reaction?, severity?}`.
- `apps/jobs/pipeline.py` `merge_card_with_profile`: sets `merged["allergies"] = [a["allergen"] for a in manual_ctx["allergies"]]` when `manual_ctx["allergies"]` is present.
- `apps/profiles/ai_item_views.py`: `DETAIL_FIELDS["allergies"] = {"reaction", "severity"}`; `AiItemEditView` rejects non-DETAIL fields.
- `src/lib/profileMedical.ts` `AllergyItem = { id, allergen, reaction, severity }`.
- `src/screens/App/MedicalProfileScreen.tsx`: `SEVERITY_OPTS = ["Mild","Moderate","Severe"]`, `OptionPills` for severity; `AI_EDITABLE.allergies = [{key:"reaction",...},{key:"severity",...}]`.
- `src/screens/App/DocumentDetailScreen.tsx`: `EDITABLE.allergies = [{key:"reaction",label:"Reaction"},{key:"severity",label:"Severity"}]`; edit sheet maps fields to `TextInput`.

---

## Task 1: Extraction schema + prompt accept `type`

**Files:**
- Modify: `backend/apps/jobs/schemas.py` (`Allergy`)
- Modify: `backend/apps/jobs/ai_client.py` (`_EXTRACT_SYSTEM`)
- Test: `backend/tests/test_intolerance.py` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_intolerance.py`:
```python
"""Phase 2A: allergy/intolerance type subfield."""
import pytest


def test_allergy_schema_has_type_default_allergy():
    from apps.jobs.schemas import Allergy
    a = Allergy(substance="Penicillin", severity="high")
    assert a.type == "allergy"
    b = Allergy(substance="Lactose", severity="low", type="intolerance")
    assert b.type == "intolerance"


def test_allergy_schema_rejects_bad_type():
    from apps.jobs.schemas import Allergy
    with pytest.raises(Exception):
        Allergy(substance="X", severity="low", type="nonsense")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_intolerance.py -v`
Expected: FAIL — `Allergy` has no `type`.

- [ ] **Step 3: Add `type` to the schema**

In `backend/apps/jobs/schemas.py`, `Allergy`:
```python
class Allergy(BaseModel):
    """Allergy information."""
    substance: str
    reaction: Optional[str] = None
    severity: Literal["low", "medium", "high", "unknown"]
    type: Literal["allergy", "intolerance"] = "allergy"
```

- [ ] **Step 4: Add the extraction rule**

In `backend/apps/jobs/ai_client.py`, inside `_EXTRACT_SYSTEM`, add a bullet after the `timeline_events` line:
```python
- For each allergy entry set type to "intolerance" ONLY when the document explicitly indicates a non-allergic intolerance (e.g. "lactose intolerance", "food intolerance", "medication intolerance"); otherwise use "allergy". Never infer intolerance from an allergy mention.
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_intolerance.py -v`
Expected: PASS (2)

- [ ] **Step 6: Commit**

```bash
git add backend/apps/jobs/schemas.py backend/apps/jobs/ai_client.py backend/tests/test_intolerance.py
git commit -m "feat(intolerance): extraction schema + prompt accept allergy type"
```

---

## Task 2: Backfill + eval-context carry `type`

**Files:**
- Modify: `backend/apps/jobs/profile_logic.py` (`AllergyItem`, `NormalizedAllergy`, `extract_backfill_candidates`, `build_manual_profile_context`, `build_ai_backfilled_context`)
- Test: `backend/tests/test_intolerance.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_intolerance.py`:
```python
def test_backfill_carries_type():
    from apps.jobs.profile_logic import extract_backfill_candidates
    docs = [{"key_facts": {"allergies": [
        {"substance": "Lactose", "reaction": "GI upset", "severity": "low", "type": "intolerance"},
        {"substance": "Penicillin", "reaction": "Hives", "severity": "high"}]}}]
    out = extract_backfill_candidates(docs)
    by = {a["allergen"]: a for a in out["allergies"]}
    assert by["Lactose"]["type"] == "intolerance"
    assert by["Penicillin"]["type"] == "allergy"   # default when absent


def test_manual_context_carries_type():
    from apps.jobs.profile_logic import build_manual_profile_context
    ctx = build_manual_profile_context({"allergies": [
        {"id": "1", "allergen": "Lactose", "type": "intolerance"}]})
    assert ctx["allergies"][0]["type"] == "intolerance"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_intolerance.py -k "carries" -v`
Expected: FAIL — `type` not present in outputs.

- [ ] **Step 3: Add `type` to TypedDicts**

In `backend/apps/jobs/profile_logic.py`:
```python
class AllergyItem(TypedDict, total=False):
    id: str
    allergen: str
    reaction: str
    severity: str
    type: str
```
```python
class NormalizedAllergy(TypedDict, total=False):
    allergen: str
    reaction: str
    severity: str
    type: str
```

- [ ] **Step 4: Carry `type` in backfill candidates**

In `extract_backfill_candidates`, the allergies append block — add `type`:
```python
            allergies.append(
                {
                    "id": ai_id(),
                    "allergen": substance,
                    "reaction": trimmed(a.get("reaction", "")) or "",
                    "severity": map_severity(a.get("severity", "")),
                    "type": a.get("type") or "allergy",
                }
            )
```

- [ ] **Step 5: Carry `type` in both context normalizers**

In `build_manual_profile_context`, inside the allergies loop, after the `severity` line:
```python
        if severity := trimmed(a.get("severity")):
            normalized["severity"] = severity
        if a.get("type") in ("allergy", "intolerance"):
            normalized["type"] = a["type"]
        allergies.append(normalized)
```
In `build_ai_backfilled_context`, inside its allergies loop, apply the same `if a.get("type") in ("allergy", "intolerance"): normalized["type"] = a["type"]` before `allergies.append(normalized)`.

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_intolerance.py -k "carries" -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/apps/jobs/profile_logic.py backend/tests/test_intolerance.py
git commit -m "feat(intolerance): backfill + eval context carry allergy type"
```

---

## Task 3: Emergency card labels intolerances

**Files:**
- Modify: `backend/apps/jobs/pipeline.py` (`merge_card_with_profile`)
- Test: `backend/tests/test_intolerance.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_intolerance.py`:
```python
def test_card_labels_intolerance():
    from apps.jobs.pipeline import merge_card_with_profile
    manual_ctx = {"allergies": [
        {"allergen": "Penicillin", "type": "allergy"},
        {"allergen": "Lactose", "type": "intolerance"}]}
    merged = merge_card_with_profile({"allergies": ["old"]}, manual_ctx, {"allergies": []})
    assert merged["allergies"] == ["Penicillin", "Lactose (intolerance)"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_intolerance.py -k card -v`
Expected: FAIL — card shows `["Penicillin", "Lactose"]` (unlabeled).

- [ ] **Step 3: Label intolerances in the card merge**

In `backend/apps/jobs/pipeline.py` `merge_card_with_profile`, replace the line:
```python
    if manual_ctx.get("allergies"):
        merged["allergies"] = [a["allergen"] for a in manual_ctx["allergies"]]
```
with:
```python
    if manual_ctx.get("allergies"):
        merged["allergies"] = [
            a["allergen"] + (" (intolerance)" if a.get("type") == "intolerance" else "")
            for a in manual_ctx["allergies"]
        ]
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_intolerance.py -k card -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/apps/jobs/pipeline.py backend/tests/test_intolerance.py
git commit -m "feat(intolerance): label intolerances on the emergency card"
```

---

## Task 4: Make `type` an editable+validated review field

**Files:**
- Modify: `backend/apps/profiles/ai_item_views.py` (`DETAIL_FIELDS`, `AiItemEditView`)
- Test: `backend/tests/test_intolerance.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_intolerance.py`:
```python
import json
from django.contrib.auth import get_user_model
from apps.profiles.models import UserProfile


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(email="intol@example.com", password="Str0ngPass!23")


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def _seed_allergy(user):
    p = UserProfile.for_user(user)
    p.allergies = [{"id": "ai_a1", "allergen": "Lactose", "severity": "Mild"}]
    p.ai_backfill_meta = {"fields": {"allergies": {"added_keys": ["lactose"],
        "current_item_ids": ["ai_a1"]}}, "last_backfill_at": ""}
    p.save()
    return p


def test_edit_can_set_type(client, user):
    p = _seed_allergy(user)
    resp = client.patch("/api/profile/ai-items/ai_a1", {"type": "intolerance"}, format="json")
    assert resp.status_code == 200
    p.refresh_from_db()
    assert p.allergies[0]["type"] == "intolerance"


def test_edit_rejects_bad_type(client, user):
    _seed_allergy(user)
    resp = client.patch("/api/profile/ai-items/ai_a1", {"type": "nope"}, format="json")
    assert resp.status_code == 400
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_intolerance.py -k edit -v`
Expected: FAIL — `type` rejected as a non-editable field (400 for the valid case too).

- [ ] **Step 3: Allow + validate `type`**

In `backend/apps/profiles/ai_item_views.py`:
```python
DETAIL_FIELDS = {
    "allergies": {"reaction", "severity", "type"},
    "medications": {"dose", "frequency"},
    "medical_history": {"year", "notes"},
    "surgical_history": {"year", "notes"},
}
```
In `AiItemEditView.patch`, after the `bad = set(incoming) - allowed` check block, add:
```python
        if "type" in incoming and incoming["type"] not in ("allergy", "intolerance"):
            return Response({"detail": "type must be 'allergy' or 'intolerance'."},
                            status=status.HTTP_400_BAD_REQUEST)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest tests/test_intolerance.py -v`
Expected: PASS (all)

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest -q`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/profiles/ai_item_views.py backend/tests/test_intolerance.py
git commit -m "feat(intolerance): allow + validate editing allergy type"
```

---

## Task 5: Client type + edit-sheet option fields

**Files:**
- Modify: `src/lib/profileMedical.ts` (`AllergyItem`)
- Modify: `src/screens/App/DocumentDetailScreen.tsx` (EDITABLE + edit sheet render)
- Modify: `src/screens/App/MedicalProfileScreen.tsx` (`AI_EDITABLE` + AiItemControls edit sheet render)

- [ ] **Step 1: Add `type` to the client type**

In `src/lib/profileMedical.ts`:
```typescript
export type AllergyItem = {
  id: string;
  allergen: string;
  reaction: string;
  severity: string;
  type?: "allergy" | "intolerance";
};
```

- [ ] **Step 2: DocumentDetail — add `type` as an option field**

In `src/screens/App/DocumentDetailScreen.tsx`, change the allergies EDITABLE entry to include `type` with options:
```typescript
const EDITABLE: Record<string, { key: string; label: string; options?: string[] }[]> = {
  allergies: [{ key: "reaction", label: "Reaction" }, { key: "severity", label: "Severity" },
              { key: "type", label: "Type", options: ["allergy", "intolerance"] }],
  medications: [{ key: "dose", label: "Dose" }, { key: "frequency", label: "Frequency" }],
  medical_history: [{ key: "year", label: "Year" }, { key: "notes", label: "Notes" }],
  surgical_history: [{ key: "year", label: "Year" }, { key: "notes", label: "Notes" }],
};
```
In the edit sheet field render (the `(EDITABLE[editing.field] ?? []).map((f) => ...)` block), render pills when `f.options` is present, else the existing `TextInput`:
```tsx
            {(EDITABLE[editing.field] ?? []).map((f) => (
              <View key={f.key} style={s.editRow}>
                <AppText style={s.editLabel}>{f.label}</AppText>
                {f.options ? (
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    {f.options.map((opt) => {
                      const sel = (editValues[f.key] || "allergy") === opt;
                      return (
                        <Pressable key={opt} onPress={() => setEditValues((v) => ({ ...v, [f.key]: opt }))}
                          style={[s.actionEdit, sel && { backgroundColor: colors.tealSoft }]}>
                          <AppText style={[s.actionEditText, sel && { color: colors.teal }]}>{opt}</AppText>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <TextInput style={s.editInput} value={editValues[f.key] ?? ""}
                    onChangeText={(t) => setEditValues((v) => ({ ...v, [f.key]: t }))}
                    placeholder={f.label} placeholderTextColor={colors.muted} />
                )}
              </View>
            ))}
```
(`openEdit` already pre-fills `editValues` from `c.current ?? c.fact`, so `type` pre-selects correctly.)

- [ ] **Step 3: MedicalProfile — mirror the option-field edit + import OptionPills already present**

In `src/screens/App/MedicalProfileScreen.tsx`, change `AI_EDITABLE.allergies`:
```typescript
const AI_EDITABLE: Record<string, { key: string; label: string; options?: string[] }[]> = {
  allergies: [{ key: "reaction", label: "Reaction" }, { key: "severity", label: "Severity" },
              { key: "type", label: "Type", options: ["allergy", "intolerance"] }],
  medications: [{ key: "dose", label: "Dose" }, { key: "frequency", label: "Frequency" }],
  medical_history: [{ key: "year", label: "Year" }, { key: "notes", label: "Notes" }],
  surgical_history: [{ key: "year", label: "Year" }, { key: "notes", label: "Notes" }],
};
```
In the AiItemControls edit-sheet field render, render `OptionPills` (already imported) for option fields:
```tsx
            {(AI_EDITABLE[field] ?? []).map((f) => (
              <View key={f.key} style={s.aiEditRow}>
                <AppText style={s.aiEditLabel}>{f.label}</AppText>
                {f.options ? (
                  <OptionPills options={f.options} selected={editValues[f.key] || "allergy"}
                    onSelect={(v) => setEditValues((s2) => ({ ...s2, [f.key]: v }))} />
                ) : (
                  <TextInput style={s.aiEditInput} value={editValues[f.key] ?? ""}
                    onChangeText={(t) => setEditValues((v) => ({ ...v, [f.key]: t }))} placeholder={f.label} />
                )}
              </View>
            ))}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: 0 `error TS` lines.

- [ ] **Step 5: Commit**

```bash
git add src/lib/profileMedical.ts src/screens/App/DocumentDetailScreen.tsx src/screens/App/MedicalProfileScreen.tsx
git commit -m "feat(intolerance): client type + editable allergy/intolerance toggle"
```

---

## Task 6: Medical Profile add-form toggle + badge

**Files:**
- Modify: `src/screens/App/MedicalProfileScreen.tsx`

- [ ] **Step 1: Add the TYPE_OPTS constant**

Near `SEVERITY_OPTS` in `src/screens/App/MedicalProfileScreen.tsx`:
```typescript
const TYPE_OPTS = ["allergy", "intolerance"];
```

- [ ] **Step 2: Add the type pills to the allergy add form**

In the allergy add form (after the Severity `OptionPills` block, ~line 700-702), add:
```tsx
                  <View style={{ gap: spacing.xs }}>
                    <AppText variant="label">Type</AppText>
                    <OptionPills options={TYPE_OPTS} selected={f("type") || "allergy"} onSelect={(v) => setField("type", v)} />
                  </View>
```

- [ ] **Step 3: Include `type` in the two manual-add item builders**

In `MedicalProfileScreen.tsx`, both places that build an allergy item from the add form (the add handler and the pending-include builder) — add `type`:
```typescript
{ id: makeId(), allergen: f("allergen").trim(), reaction: f("reaction").trim(), severity: f("severity"), type: (f("type") || "allergy") as "allergy" | "intolerance" }
```
(Apply to both the `setEditAllergies((prev) => [...prev, {...}])` line and the `pending ? [...editAllergies, {...}]` line.)

- [ ] **Step 4: Show an "Intolerance" badge on intolerance rows**

In both allergy `ItemRow` render sites (the manual-list row and the AI-item row), append a label to the secondary text when the item is an intolerance:
```tsx
                      <ItemRow primary={item.allergen}
                        secondary={joinParts(item.reaction, item.severity, (item as any).type === "intolerance" ? "Intolerance" : null)} />
```
(`joinParts` ignores null/empty, so allergies are unaffected.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 `error TS` lines.

- [ ] **Step 6: Commit**

```bash
git add src/screens/App/MedicalProfileScreen.tsx
git commit -m "feat(intolerance): add-form type toggle + intolerance badge"
```

---

## Task 7: Client unit test for the add-form item shape

**Files:**
- Create: `src/lib/intolerance.ts` (tiny pure helper)
- Test: `src/lib/intolerance.test.ts`
- Modify: `src/screens/App/MedicalProfileScreen.tsx` (use the helper in the add builders)

- [ ] **Step 1: Write the failing test**

Create `src/lib/intolerance.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { allergySecondaryLabel } from "./intolerance";

describe("allergySecondaryLabel", () => {
  it("labels intolerance", () => {
    expect(allergySecondaryLabel("Hives", "Mild", "intolerance")).toContain("Intolerance");
  });
  it("does not label a normal allergy", () => {
    expect(allergySecondaryLabel("Hives", "Severe", "allergy")).not.toContain("Intolerance");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/intolerance.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/intolerance.ts`:
```typescript
// Builds the secondary line for an allergy row, labeling intolerances.
export function allergySecondaryLabel(
  reaction?: string, severity?: string, type?: "allergy" | "intolerance",
): string {
  return [reaction, severity, type === "intolerance" ? "Intolerance" : null]
    .filter((p) => p && String(p).trim())
    .join(" · ");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/intolerance.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/intolerance.ts src/lib/intolerance.test.ts
git commit -m "test(intolerance): allergy secondary-label helper"
```

---

## Task 8: Full verification

- [ ] **Step 1: Backend suite**

Run: `cd backend && DATABASE_URL='postgres://rivr:rivr@localhost:5433/rivr' OPENAI_API_KEY='' .venv/bin/pytest -q`
Expected: all PASS.

- [ ] **Step 2: Client typecheck + tests**

Run: `npx vitest run src/lib/intolerance.test.ts && npm run typecheck`
Expected: vitest PASS; typecheck 0 `error TS` lines.

---

## Self-review checklist

- **Spec §4.1 (schema + prompt):** Task 1. ✓
- **Spec §4.2 (backfill + context carry type):** Task 2. ✓
- **Spec §4.3 (card labeling):** Task 3. ✓
- **Spec §4.4 (edit allow + validate):** Task 4. ✓
- **Spec §5.1 (client type):** Task 5 step 1. ✓
- **Spec §5.2 (add form toggle, badge):** Task 6. ✓
- **Spec §5.3 (edit-sheet option fields):** Task 5 steps 2-3. ✓
- **Spec §5.4 (Health Summary unchanged):** no task needed (renders backend card). ✓
- **Spec §6 (tests):** Tasks 1-4 (backend), 7 (client). ✓
- **Identity unchanged (allergy_key):** type is never added to any `*_key` fn — verified, no key fn touched. ✓
- **Type consistency:** `type` values are lowercase `"allergy"|"intolerance"` everywhere (schema, backfill default, edit validation, client type, OptionPills options). ✓
