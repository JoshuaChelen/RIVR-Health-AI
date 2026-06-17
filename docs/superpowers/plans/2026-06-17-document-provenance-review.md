# Document Provenance & Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users see what each document's AI analysis produced, trace every finding to its source file, confirm/edit/reject individual findings, cancel a document's results (keeping the file), and re-run the analysis.

**Architecture:** Provenance is **computed** by joining each document's immutable `summary.json` to the profile arrays via the existing normalized keys — no provenance column, no data migration. The only new persisted state is per-item `review_status`/`ai_original` on `ai_`-id items (server-owned). Reject reuses the existing suppression engine; detach additionally strips keys from `ai_backfill_meta.added_keys` so it stays reversible. One additive `Document.detached_at` field gates whether a document still feeds the eval.

**Tech Stack:** Django 5 / DRF / Celery / pytest (backend); Expo React Native / TypeScript / jest (client). Object storage via `default_storage` (MinIO/S3 in prod, in-memory in tests).

---

## Reference: shapes & helpers (read before starting)

**Profile array item shapes** (`apps/profiles/models.py`, JSON arrays on `UserProfile`):
- `allergies`: `{id, allergen, reaction, severity}`
- `medications`: `{id, name, dose, frequency}`
- `medical_history`: `{id, condition, year, notes}`
- `surgical_history`: `{id, procedure, year, notes}`

**Document `summary.json` `key_facts` shapes** (`apps/jobs/schemas.py`):
- `allergies`: `{substance, reaction, severity}`
- `medications`: `{name, dose, frequency, notes}`
- `conditions`: `{name, status, notes}`
- `surgeries_procedures`: `{name, when, notes}`

**Existing helpers in `apps/jobs/profile_logic.py`** (import, do not reimplement):
- `is_ai_backfilled(id) -> bool` (id starts with `ai_`)
- `allergy_key(s)`, `medication_key(s)` (strips trailing dosage), `med_history_key(s)`, `surgery_key(s)`, `norm(s)`
- `compute_suppressed_keys(profile_dict) -> {allergies, medications, conditions, surgeries}` (sets of normalized keys)

**The 4 AI-backfilled fields** (the ONLY fields with review surfaces):
`allergies`, `medications`, `medical_history`, `surgical_history`.

**FIELD_MAP** (used across provenance code — define once in Task 2):

| profile_field | doc key_facts field | suppressed bucket | doc key fn | profile key fn | name field |
|---|---|---|---|---|---|
| allergies | allergies | allergies | `allergy_key(f["substance"])` | `allergy_key(i["allergen"])` | substance/allergen |
| medications | medications | medications | `medication_key(f["name"])` | `medication_key(i["name"])` | name |
| medical_history | conditions | conditions | `med_history_key(f["name"])` | `med_history_key(i["condition"])` | name/condition |
| surgical_history | surgeries_procedures | surgeries | `surgery_key(f["name"])` | `surgery_key(i["procedure"])` | name/procedure |

---

## Phase A — Backend data model & provenance core

### Task 1: Add `Document.detached_at`

**Files:**
- Modify: `backend/apps/documents/models.py:38-39` (after `processed_at`)
- Create: `backend/apps/documents/migrations/00NN_document_detached_at.py` (generated)
- Test: `backend/tests/test_models.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_models.py`:
```python
def test_document_detached_at_defaults_none(db):
    from django.contrib.auth import get_user_model
    from apps.documents.models import Document
    u = get_user_model().objects.create_user(email="det@example.com", password="Str0ngPass!23")
    d = Document.objects.create(user=u, source_type="file")
    assert d.detached_at is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_models.py::test_document_detached_at_defaults_none -v`
Expected: FAIL — `AttributeError: 'Document' object has no attribute 'detached_at'`

- [ ] **Step 3: Add the field**

In `backend/apps/documents/models.py`, immediately after the `processed_at` field:
```python
    processed_at = models.DateTimeField(null=True, blank=True)
    detached_at = models.DateTimeField(null=True, blank=True)
```

- [ ] **Step 4: Generate the migration**

Run: `cd backend && .venv/bin/python manage.py makemigrations documents`
Expected: creates `apps/documents/migrations/00NN_document_detached_at.py` adding `detached_at`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_models.py::test_document_detached_at_defaults_none -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/apps/documents/models.py backend/apps/documents/migrations/ backend/tests/test_models.py
git commit -m "feat(documents): add detached_at field"
```

---

### Task 2: Provenance read model (`provenance.py` — keys, contributions, analysis)

**Files:**
- Create: `backend/apps/documents/provenance.py`
- Test: `backend/tests/test_provenance.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_provenance.py`:
```python
"""Provenance computation: join a document's summary.json to the profile arrays."""
import json
import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

from apps.documents.models import Document
from apps.documents import provenance
from apps.profiles.models import UserProfile

User = get_user_model()
PW = "Str0ngPass!23"


@pytest.fixture
def user(db):
    return User.objects.create_user(email="prov@example.com", password=PW)


def _write_summary(user_id, doc_id, key_facts, confidence=0.8, timeline=None):
    key = f"documents/{user_id}/processed/{doc_id}/summary.json"
    payload = {
        "document_id": str(doc_id), "title": "Doc",
        "key_facts": {"blood_type": None, "allergies": [], "medications": [],
                      "conditions": [], "surgeries_procedures": [], "implants_devices": [],
                      "key_labs_vitals": [], "extra_notes": [], **key_facts},
        "timeline_events": timeline or [], "confidence_0_to_1": confidence,
    }
    if default_storage.exists(key):
        default_storage.delete(key)
    default_storage.save(key, ContentFile(json.dumps(payload).encode()))
    return key


def test_contribution_present_unreviewed(user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    doc.summary_path = _write_summary(user.id, doc.id, {"medications": [{"name": "Metformin", "dose": "500mg"}]})
    doc.save()
    profile = UserProfile.for_user(user)
    profile.medications = [{"id": "ai_abc", "name": "Metformin", "dose": "500mg"}]
    profile.save()

    analysis = provenance.build_analysis(user, doc)
    meds = [c for c in analysis["contributions"] if c["field"] == "medications"]
    assert len(meds) == 1
    assert meds[0]["state"] == "unreviewed"
    assert meds[0]["origin"] == "ai"
    assert meds[0]["profile_item_id"] == "ai_abc"
    assert analysis["confidence_0_to_1"] == 0.8


def test_contribution_confirmed_and_edited(user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    doc.summary_path = _write_summary(user.id, doc.id, {
        "allergies": [{"substance": "Penicillin", "severity": "high"}],
        "conditions": [{"name": "Asthma"}],
    })
    doc.save()
    profile = UserProfile.for_user(user)
    profile.allergies = [{"id": "ai_a1", "allergen": "Penicillin", "review_status": "confirmed"}]
    profile.medical_history = [{"id": "ai_c1", "condition": "Asthma", "review_status": "edited",
                                "ai_original": {"condition": "Asthma", "notes": ""}}]
    profile.save()

    contribs = {c["field"]: c for c in provenance.build_analysis(user, doc)["contributions"]}
    assert contribs["allergies"]["state"] == "confirmed"
    assert contribs["medical_history"]["state"] == "edited"
    assert contribs["medical_history"]["ai_original"]["condition"] == "Asthma"


def test_contribution_rejected_vs_not_added(user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    doc.summary_path = _write_summary(user.id, doc.id, {
        "medications": [{"name": "Aspirin"}, {"name": "Ibuprofen"}],
    })
    doc.save()
    profile = UserProfile.for_user(user)
    # Aspirin was AI-added then removed by the user -> recorded in added_keys -> rejected.
    # Ibuprofen never made it into the array and is not in added_keys -> not_added.
    profile.medications = []
    profile.ai_backfill_meta = {"fields": {"medications": {"source": "ai", "job_id": "j",
        "added_keys": ["aspirin"], "current_item_ids": []}}, "last_backfill_at": ""}
    profile.save()

    states = {c["label"].lower(): c["state"] for c in provenance.build_analysis(user, doc)["contributions"]}
    assert states["aspirin"] == "rejected"
    assert states["ibuprofen"] == "not_added"


def test_manual_item_shows_as_present_manual(user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    doc.summary_path = _write_summary(user.id, doc.id, {"allergies": [{"substance": "Latex"}]})
    doc.save()
    profile = UserProfile.for_user(user)
    profile.allergies = [{"id": "manual-1", "allergen": "Latex"}]  # no ai_ prefix
    profile.save()
    c = provenance.build_analysis(user, doc)["contributions"][0]
    assert c["origin"] == "manual"
    assert c["state"] == "present"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_provenance.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.documents.provenance'`

- [ ] **Step 3: Implement `provenance.py` (read side)**

Create `backend/apps/documents/provenance.py`:
```python
"""Computed document → profile provenance.

Provenance is NOT stored. For a processed document we read its immutable
summary.json and join each extracted fact to the user's profile arrays using
the SAME normalized keys the suppression engine uses. The only persisted
per-item state we read is `review_status` / `ai_original` on ai_-id items.
"""
from __future__ import annotations

import json
from typing import Any, Callable

from django.core.files.storage import default_storage

from apps.jobs import profile_logic as pl
from apps.profiles.models import UserProfile


# ── FIELD_MAP ────────────────────────────────────────────────────────────────
# Each entry binds one profile array field to its document key_facts field and
# the key functions used to match them.
class _FieldCfg:
    def __init__(self, profile_field, doc_field, suppressed_bucket,
                 doc_key: Callable, profile_key: Callable, label: Callable):
        self.profile_field = profile_field
        self.doc_field = doc_field
        self.suppressed_bucket = suppressed_bucket
        self.doc_key = doc_key
        self.profile_key = profile_key
        self.label = label


FIELD_MAP: list[_FieldCfg] = [
    _FieldCfg("allergies", "allergies", "allergies",
              lambda f: pl.allergy_key(f.get("substance", "") or ""),
              lambda i: pl.allergy_key(i.get("allergen", "") or ""),
              lambda f: f.get("substance", "") or ""),
    _FieldCfg("medications", "medications", "medications",
              lambda f: pl.medication_key(f.get("name", "") or ""),
              lambda i: pl.medication_key(i.get("name", "") or ""),
              lambda f: f.get("name", "") or ""),
    _FieldCfg("medical_history", "conditions", "conditions",
              lambda f: pl.med_history_key(f.get("name", "") or ""),
              lambda i: pl.med_history_key(i.get("condition", "") or ""),
              lambda f: f.get("name", "") or ""),
    _FieldCfg("surgical_history", "surgeries_procedures", "surgeries",
              lambda f: pl.surgery_key(f.get("name", "") or ""),
              lambda i: pl.surgery_key(i.get("procedure", "") or ""),
              lambda f: f.get("name", "") or ""),
]


def read_summary(summary_path: str) -> dict | None:
    if not summary_path:
        return None
    try:
        with default_storage.open(summary_path) as fh:
            return json.loads(fh.read())
    except Exception:
        return None


def _profile_dict(profile: UserProfile) -> dict:
    return {f.profile_field: (getattr(profile, f.profile_field) or []) for f in FIELD_MAP} | {
        "ai_backfill_meta": profile.ai_backfill_meta or {}}


def compute_contributions(profile: UserProfile, summary: dict) -> list[dict]:
    """For each fact in the document's summary, resolve its current profile state."""
    pdict = _profile_dict(profile)
    suppressed = pl.compute_suppressed_keys(pdict)
    key_facts = (summary or {}).get("key_facts", {}) or {}
    out: list[dict] = []

    for cfg in FIELD_MAP:
        # Index current profile items by normalized key.
        by_key: dict[str, dict] = {}
        for it in pdict[cfg.profile_field]:
            if isinstance(it, dict):
                k = cfg.profile_key(it)
                if k:
                    by_key[k] = it
        for fact in (key_facts.get(cfg.doc_field) or []):
            if not isinstance(fact, dict):
                continue
            key = cfg.doc_key(fact)
            if not key:
                continue
            label = cfg.label(fact)
            item = by_key.get(key)
            if item is not None:
                is_ai = pl.is_ai_backfilled(item.get("id"))
                out.append({
                    "field": cfg.profile_field,
                    "label": label,
                    "fact": fact,
                    "origin": "ai" if is_ai else "manual",
                    "state": (item.get("review_status") or "unreviewed") if is_ai else "present",
                    "profile_item_id": item.get("id"),
                    "ai_original": item.get("ai_original"),
                })
            else:
                rejected = key in suppressed.get(cfg.suppressed_bucket, set())
                out.append({
                    "field": cfg.profile_field,
                    "label": label,
                    "fact": fact,
                    "origin": "ai",
                    "state": "rejected" if rejected else "not_added",
                    "profile_item_id": None,
                    "ai_original": None,
                })
    return out


def build_analysis(user, document) -> dict:
    """Full per-document analysis payload: confidence + raw facts + contributions."""
    summary = read_summary(document.summary_path) or {}
    profile = UserProfile.for_user(user)
    return {
        "document_id": str(document.id),
        "title": document.title,
        "confidence_0_to_1": summary.get("confidence_0_to_1"),
        "key_facts": summary.get("key_facts", {}),
        "timeline_events": summary.get("timeline_events", []),
        "contributions": compute_contributions(profile, summary),
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_provenance.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/documents/provenance.py backend/tests/test_provenance.py
git commit -m "feat(documents): computed provenance read model"
```

---

### Task 3: Detach + shared-finding protection (`provenance.py` — write side)

**Files:**
- Modify: `backend/apps/documents/provenance.py` (append)
- Test: `backend/tests/test_provenance.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_provenance.py`:
```python
def test_detach_removes_unique_keeps_shared(user):
    # docA contributes Metformin (unique) + Aspirin (shared with docB).
    docA = Document.objects.create(user=user, source_type="pdf", status="processed")
    docA.summary_path = _write_summary(user.id, docA.id,
        {"medications": [{"name": "Metformin"}, {"name": "Aspirin"}]})
    docA.save()
    docB = Document.objects.create(user=user, source_type="pdf", status="processed")
    docB.summary_path = _write_summary(user.id, docB.id, {"medications": [{"name": "Aspirin"}]})
    docB.save()

    profile = UserProfile.for_user(user)
    profile.medications = [
        {"id": "ai_met", "name": "Metformin"},
        {"id": "ai_asp", "name": "Aspirin"},
    ]
    profile.ai_backfill_meta = {"fields": {"medications": {"source": "ai", "job_id": "j",
        "added_keys": ["metformin", "aspirin"], "current_item_ids": ["ai_met", "ai_asp"]}},
        "last_backfill_at": ""}
    profile.save()

    summary = provenance.detach_document(user, docA)
    profile.refresh_from_db()
    names = [m["name"] for m in profile.medications]
    assert names == ["Aspirin"]                      # Metformin removed, Aspirin kept (shared)
    assert summary["removed"]["medications"] == 1
    assert summary["kept_shared"]["medications"] == 1
    docA.refresh_from_db()
    assert docA.detached_at is not None
    # Detach is reversible: the removed key must NOT linger in added_keys (else it
    # would be treated as suppressed and never come back on re-run).
    assert "metformin" not in profile.ai_backfill_meta["fields"]["medications"]["added_keys"]


def test_detach_protects_manual_item(user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    doc.summary_path = _write_summary(user.id, doc.id, {"allergies": [{"substance": "Latex"}]})
    doc.save()
    profile = UserProfile.for_user(user)
    profile.allergies = [{"id": "manual-1", "allergen": "Latex"}]  # manual, never touched
    profile.save()
    summary = provenance.detach_document(user, doc)
    profile.refresh_from_db()
    assert len(profile.allergies) == 1                # manual item untouched
    assert summary["removed"].get("allergies", 0) == 0


def test_detach_deletes_document_ai_timeline_events(user):
    from apps.timeline.models import TimelineEvent
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    doc.summary_path = _write_summary(user.id, doc.id, {})
    doc.save()
    TimelineEvent.objects.create(user=user, document=doc, source="document_ai", title="X")
    TimelineEvent.objects.create(user=user, document=doc, source="manual", title="keep")
    provenance.detach_document(user, doc)
    assert TimelineEvent.objects.filter(document=doc, source="document_ai").count() == 0
    assert TimelineEvent.objects.filter(document=doc, source="manual").count() == 1
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_provenance.py -k detach -v`
Expected: FAIL — `AttributeError: module 'apps.documents.provenance' has no attribute 'detach_document'`

- [ ] **Step 3: Implement the write side**

Append to `backend/apps/documents/provenance.py`:
```python
from django.db import transaction
from django.utils import timezone as djtz


def _active_other_summaries(user, exclude_doc_id) -> list[dict]:
    """Summaries of the user's other ACTIVE processed docs (not detached, not manual)."""
    from .models import Document
    qs = (Document.objects
          .filter(user=user, status=Document.Status.PROCESSED, detached_at__isnull=True)
          .exclude(source_type=Document.SourceType.MANUAL_INPUT)
          .exclude(id=exclude_doc_id)
          .values_list("summary_path", flat=True))
    out = []
    for path in qs:
        data = read_summary(path)
        if data:
            out.append(data)
    return out


def documents_sharing_key(profile: UserProfile, other_summaries: list[dict],
                          cfg: _FieldCfg, key: str) -> bool:
    """True if `key` is also backed by a manual profile item or another active doc."""
    for it in (getattr(profile, cfg.profile_field) or []):
        if isinstance(it, dict) and not pl.is_ai_backfilled(it.get("id")) and cfg.profile_key(it) == key:
            return True
    for summary in other_summaries:
        facts = (summary.get("key_facts", {}) or {}).get(cfg.doc_field) or []
        for fact in facts:
            if isinstance(fact, dict) and cfg.doc_key(fact) == key:
                return True
    return False


@transaction.atomic
def detach_document(user, document) -> dict:
    """Remove this document's UNIQUE ai contributions; keep shared/manual ones.

    Reversible: removed keys are stripped from ai_backfill_meta.added_keys so a
    later re-run restores them. Sets detached_at and deletes the doc's
    document_ai timeline events. The file/summary are retained.
    """
    from apps.timeline.models import TimelineEvent

    profile = UserProfile.for_user(user)
    summary = read_summary(document.summary_path) or {}
    key_facts = summary.get("key_facts", {}) or {}
    other = _active_other_summaries(user, document.id)
    meta = profile.ai_backfill_meta or {"fields": {}, "last_backfill_at": ""}
    fields_meta = meta.get("fields", {})

    removed: dict[str, int] = {}
    kept_shared: dict[str, int] = {}
    changed_fields: list[str] = []

    for cfg in FIELD_MAP:
        doc_keys = {cfg.doc_key(f) for f in (key_facts.get(cfg.doc_field) or [])
                    if isinstance(f, dict) and cfg.doc_key(f)}
        if not doc_keys:
            continue
        arr = getattr(profile, cfg.profile_field) or []
        kept_items, removed_keys = [], set()
        for it in arr:
            if not isinstance(it, dict):
                kept_items.append(it); continue
            k = cfg.profile_key(it)
            if pl.is_ai_backfilled(it.get("id")) and k in doc_keys:
                if documents_sharing_key(profile, other, cfg, k):
                    kept_items.append(it)
                    kept_shared[cfg.profile_field] = kept_shared.get(cfg.profile_field, 0) + 1
                else:
                    removed_keys.add(k)
                    removed[cfg.profile_field] = removed.get(cfg.profile_field, 0) + 1
            else:
                kept_items.append(it)
        if removed_keys:
            setattr(profile, cfg.profile_field, kept_items)
            changed_fields.append(cfg.profile_field)
            fm = fields_meta.get(cfg.profile_field)
            if fm:
                fm["added_keys"] = [x for x in fm.get("added_keys", []) if x not in removed_keys]
                kept_ids = {it.get("id") for it in kept_items}
                fm["current_item_ids"] = [i for i in fm.get("current_item_ids", []) if i in kept_ids]

    if changed_fields:
        profile.ai_backfill_meta = meta
        profile.save(update_fields=[*changed_fields, "ai_backfill_meta", "updated_at"])

    TimelineEvent.objects.filter(user=user, document_id=document.id, source="document_ai").delete()
    document.detached_at = djtz.now()
    document.save(update_fields=["detached_at", "updated_at"])

    return {"removed": removed, "kept_shared": kept_shared}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_provenance.py -v`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/documents/provenance.py backend/tests/test_provenance.py
git commit -m "feat(documents): detach with shared-finding protection"
```

---

## Phase B — Backend endpoints

### Task 4: Document endpoints — analysis / reprocess / detach + serializer + filter + destroy hardening

**Files:**
- Modify: `backend/apps/documents/views.py`
- Modify: `backend/apps/documents/serializers.py:6-10`
- Modify: `backend/apps/documents/filters.py`
- Test: `backend/tests/test_documents_review.py` (new)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_documents_review.py`:
```python
"""Document review endpoints: analysis, detach, reprocess, destroy hardening."""
import json
import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

from apps.documents.models import Document
from apps.profiles.models import UserProfile

User = get_user_model()
PW = "Str0ngPass!23"


@pytest.fixture
def user(db):
    return User.objects.create_user(email="rev@example.com", password=PW)


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def _summary(user_id, doc_id, key_facts):
    key = f"documents/{user_id}/processed/{doc_id}/summary.json"
    default_storage.save(key, ContentFile(json.dumps({
        "document_id": str(doc_id), "key_facts": {"allergies": [], "medications": [],
        "conditions": [], "surgeries_procedures": [], "implants_devices": [],
        "key_labs_vitals": [], "extra_notes": [], **key_facts},
        "timeline_events": [], "confidence_0_to_1": 0.7}).encode()))
    return key


def test_analysis_returns_contributions(client, user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    doc.summary_path = _summary(user.id, doc.id, {"medications": [{"name": "Metformin"}]})
    doc.save()
    resp = client.get(f"/api/documents/{doc.id}/analysis/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["confidence_0_to_1"] == 0.7
    assert body["contributions"][0]["label"] == "Metformin"


def test_analysis_404_when_not_processed(client, user):
    doc = Document.objects.create(user=user, source_type="pdf", status="uploaded")
    assert client.get(f"/api/documents/{doc.id}/analysis/").status_code == 404


def test_analysis_404_for_manual_input(client, user):
    doc = Document.objects.create(user=user, source_type="manual_input", status="processed")
    assert client.get(f"/api/documents/{doc.id}/analysis/").status_code == 404


def test_detach_endpoint_sets_detached_and_returns_summary(client, user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    doc.summary_path = _summary(user.id, doc.id, {"medications": [{"name": "Metformin"}]})
    doc.save()
    profile = UserProfile.for_user(user)
    profile.medications = [{"id": "ai_m", "name": "Metformin"}]
    profile.ai_backfill_meta = {"fields": {"medications": {"added_keys": ["metformin"],
        "current_item_ids": ["ai_m"]}}, "last_backfill_at": ""}
    profile.save()
    resp = client.post(f"/api/documents/{doc.id}/detach/")
    assert resp.status_code == 200
    assert resp.json()["removed"]["medications"] == 1
    doc.refresh_from_db(); profile.refresh_from_db()
    assert doc.detached_at is not None
    assert profile.medications == []


def test_reprocess_clears_detached_and_enqueues(client, user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    from django.utils import timezone
    doc.detached_at = timezone.now(); doc.save()
    resp = client.post(f"/api/documents/{doc.id}/reprocess/")
    assert resp.status_code == 202
    doc.refresh_from_db()
    assert doc.detached_at is None
    assert doc.status == "processing"


def test_reprocess_rejects_manual_input(client, user):
    doc = Document.objects.create(user=user, source_type="manual_input", status="processed")
    assert client.post(f"/api/documents/{doc.id}/reprocess/").status_code == 400


def test_destroy_removes_summary_and_contributions(client, user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    skey = _summary(user.id, doc.id, {"medications": [{"name": "Metformin"}]})
    doc.summary_path = skey; doc.save()
    profile = UserProfile.for_user(user)
    profile.medications = [{"id": "ai_m", "name": "Metformin"}]
    profile.ai_backfill_meta = {"fields": {"medications": {"added_keys": ["metformin"],
        "current_item_ids": ["ai_m"]}}, "last_backfill_at": ""}
    profile.save()
    assert client.delete(f"/api/documents/{doc.id}/").status_code == 204
    assert not default_storage.exists(skey)
    profile.refresh_from_db()
    assert profile.medications == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_documents_review.py -v`
Expected: FAIL — 404s on the new routes / `summary` still exists after delete.

- [ ] **Step 3: Add `detached_at` to the serializer**

In `backend/apps/documents/serializers.py`, extend `read_only_fields`:
```python
        read_only_fields = ["id", "created_at", "updated_at", "processed_at", "detached_at"]
```

- [ ] **Step 4: Add the endpoints + harden destroy in `views.py`**

Replace `backend/apps/documents/views.py` with:
```python
from django.db import transaction
from django.utils import timezone as djtz
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.common import storage
from apps.common.viewsets import OwnedModelViewSet

from .filters import DocumentFilter
from .models import Document
from .serializers import DocumentSerializer

PROCESS_TASK = "apps.jobs.tasks.process_documents_task"


class DocumentViewSet(OwnedModelViewSet):
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
    filterset_class = DocumentFilter
    ordering_fields = ["created_at", "processed_at"]
    ordering = ["-created_at"]

    def perform_destroy(self, instance: Document) -> None:
        # Detach contributions first (idempotent) so deleting a processed doc
        # doesn't orphan AI items, then remove BOTH stored objects.
        if instance.source_type != Document.SourceType.MANUAL_INPUT and instance.summary_path:
            from .provenance import detach_document
            detach_document(self.request.user, instance)
            storage.delete(instance.summary_path)
        storage.delete(instance.pdf_path)
        super().perform_destroy(instance)

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def upload(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"detail": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)
        source_type = request.data.get("source_type", Document.SourceType.FILE)
        kind = storage.document_kind(upload.content_type, source_type)
        key = storage.document_key(request.user.id, upload.name, kind)
        saved = storage.save(key, upload)
        doc = Document.objects.create(
            user=request.user,
            title=request.data.get("title", "") or upload.name,
            source_type=source_type,
            status=Document.Status.UPLOADED,
            pdf_path=saved,
            mime_type=upload.content_type or "",
            size_bytes=upload.size,
            sha256=storage.sha256_of(upload),
        )
        return Response(DocumentSerializer(doc).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def file(self, request, pk=None):
        doc = self.get_object()
        return Response({"url": storage.signed_url(doc.pdf_path)})

    @action(detail=True, methods=["get"])
    def analysis(self, request, pk=None):
        doc = self.get_object()
        if (doc.source_type == Document.SourceType.MANUAL_INPUT
                or doc.status != Document.Status.PROCESSED or not doc.summary_path):
            return Response({"detail": "No analysis available."}, status=status.HTTP_404_NOT_FOUND)
        from .provenance import build_analysis
        return Response(build_analysis(request.user, doc))

    @action(detail=True, methods=["post"])
    def detach(self, request, pk=None):
        doc = self.get_object()
        if doc.source_type == Document.SourceType.MANUAL_INPUT:
            return Response({"detail": "Manual records have no detachable results."},
                            status=status.HTTP_400_BAD_REQUEST)
        from .provenance import detach_document
        return Response(detach_document(request.user, doc))

    @action(detail=True, methods=["post"])
    def reprocess(self, request, pk=None):
        doc = self.get_object()
        if doc.source_type == Document.SourceType.MANUAL_INPUT:
            return Response({"detail": "Manual records cannot be reprocessed."},
                            status=status.HTTP_400_BAD_REQUEST)
        from apps.jobs.services import enqueue_processing
        from config import celery_app
        Document.objects.filter(id=doc.id).update(detached_at=None)
        job, reused = enqueue_processing(request.user, [doc.id])
        if job is None:
            return Response({"detail": "Nothing to process."}, status=status.HTTP_400_BAD_REQUEST)
        if not reused:
            transaction.on_commit(
                lambda: celery_app.send_task(PROCESS_TASK, args=[str(job.id)]))
        return Response({"jobId": str(job.id), "reused": reused},
                        status=status.HTTP_202_ACCEPTED)
```

- [ ] **Step 5: Add a `detached` filter helper**

In `backend/apps/documents/filters.py`, add inside `DocumentFilter`:
```python
    detached = filters.BooleanFilter(field_name="detached_at", lookup_expr="isnull", exclude=True)
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_documents_review.py -v`
Expected: PASS (all). Note: `transaction.on_commit` callbacks don't fire under the test transaction, so the reprocess test asserts only job creation + state, matching `test_jobs_enqueue.py`.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/documents/ backend/tests/test_documents_review.py
git commit -m "feat(documents): analysis/detach/reprocess endpoints + destroy cleanup"
```

---

### Task 5: Exclude detached docs from the eval digest

**Files:**
- Modify: `backend/apps/jobs/pipeline.py:300-303` and `:319-321`
- Test: `backend/tests/test_pipeline.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_pipeline.py`:
```python
def test_detached_docs_excluded_from_digest_query(db):
    """The digest must only union ACTIVE processed docs (detached_at IS NULL)."""
    from django.contrib.auth import get_user_model
    from django.utils import timezone
    from apps.documents.models import Document

    u = get_user_model().objects.create_user(email="dig@example.com", password="Str0ngPass!23")
    active = Document.objects.create(user=u, source_type="pdf", status="processed",
                                     summary_path="documents/x/processed/a/summary.json")
    Document.objects.create(user=u, source_type="pdf", status="processed",
                            summary_path="documents/x/processed/b/summary.json",
                            detached_at=timezone.now())
    ids = list(Document.objects.filter(
        user=u, status=Document.Status.PROCESSED, summary_path__gt="", detached_at__isnull=True
    ).exclude(source_type=Document.SourceType.MANUAL_INPUT).values_list("id", flat=True))
    assert ids == [active.id]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_pipeline.py::test_detached_docs_excluded_from_digest_query -v`
Expected: PASS only after the field exists (Task 1 done) — but this test documents intent; if it already passes, it still guards the query. Proceed to wire the real query.

- [ ] **Step 3: Add `detached_at__isnull=True` to both digest queries**

In `backend/apps/jobs/pipeline.py`, `_common_tail`, update the `digest_processed_ids` query (~line 300) and the `historical` loop query (~line 319) to add `detached_at__isnull=True`:
```python
        digest_processed_ids = [str(i) for i in Document.objects.filter(
            user_id=user_id, status=Document.Status.PROCESSED, summary_path__gt="",
            detached_at__isnull=True,
        ).exclude(source_type=Document.SourceType.MANUAL_INPUT).values_list("id", flat=True)]
```
```python
        for d in Document.objects.filter(
            user_id=user_id, status=Document.Status.PROCESSED, summary_path__gt="",
            detached_at__isnull=True,
        ).exclude(source_type=Document.SourceType.MANUAL_INPUT).exclude(id__in=limited_doc_ids).order_by("created_at"):
```

- [ ] **Step 4: Run the pipeline tests**

Run: `cd backend && .venv/bin/pytest tests/test_pipeline.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/apps/jobs/pipeline.py backend/tests/test_pipeline.py
git commit -m "feat(jobs): exclude detached documents from the eval digest"
```

---

### Task 6: Profile AI-item endpoints (confirm / reject / edit / sources)

**Files:**
- Create: `backend/apps/profiles/ai_item_views.py`
- Modify: `backend/apps/profiles/urls.py`
- Test: `backend/tests/test_ai_items.py` (new)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_ai_items.py`:
```python
"""Per-item review endpoints on AI-backfilled profile items."""
import json
import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

from apps.documents.models import Document
from apps.profiles.models import UserProfile

User = get_user_model()
PW = "Str0ngPass!23"


@pytest.fixture
def user(db):
    return User.objects.create_user(email="item@example.com", password=PW)


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.fixture
def profile_with_med(user):
    p = UserProfile.for_user(user)
    p.medications = [{"id": "ai_m1", "name": "Metformin", "dose": "500mg"}]
    p.ai_backfill_meta = {"fields": {"medications": {"added_keys": ["metformin"],
        "current_item_ids": ["ai_m1"]}}, "last_backfill_at": ""}
    p.save()
    return p


def test_confirm_sets_status(client, user, profile_with_med):
    resp = client.post("/api/profile/ai-items/ai_m1/confirm")
    assert resp.status_code == 200
    profile_with_med.refresh_from_db()
    assert profile_with_med.medications[0]["review_status"] == "confirmed"
    assert profile_with_med.medications[0]["reviewed_at"]


def test_edit_detail_snapshots_original(client, user, profile_with_med):
    resp = client.patch("/api/profile/ai-items/ai_m1", {"dose": "1000mg"}, format="json")
    assert resp.status_code == 200
    profile_with_med.refresh_from_db()
    m = profile_with_med.medications[0]
    assert m["dose"] == "1000mg"
    assert m["review_status"] == "edited"
    assert m["ai_original"]["dose"] == "500mg"


def test_edit_rejects_key_field_change(client, user, profile_with_med):
    resp = client.patch("/api/profile/ai-items/ai_m1", {"name": "Insulin"}, format="json")
    assert resp.status_code == 400


def test_reject_removes_item(client, user, profile_with_med):
    resp = client.post("/api/profile/ai-items/ai_m1/reject")
    assert resp.status_code == 200
    profile_with_med.refresh_from_db()
    assert profile_with_med.medications == []
    # added_keys retained -> suppression keeps it from resurfacing.
    assert "metformin" in profile_with_med.ai_backfill_meta["fields"]["medications"]["added_keys"]


def test_sources_lists_documents(client, user, profile_with_med):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed", title="Labs")
    key = f"documents/{user.id}/processed/{doc.id}/summary.json"
    default_storage.save(key, ContentFile(json.dumps({"key_facts": {"medications":
        [{"name": "Metformin"}]}, "timeline_events": [], "confidence_0_to_1": 0.5}).encode()))
    doc.summary_path = key; doc.save()
    resp = client.get("/api/profile/ai-items/ai_m1/sources")
    assert resp.status_code == 200
    assert resp.json()["sources"][0]["title"] == "Labs"


def test_item_404_for_unknown_id(client, user, profile_with_med):
    assert client.post("/api/profile/ai-items/ai_nope/confirm").status_code == 404


def test_item_endpoints_owner_scoped(api_client, profile_with_med):
    other = User.objects.create_user(email="evil@example.com", password=PW)
    api_client.force_authenticate(user=other)
    assert api_client.post("/api/profile/ai-items/ai_m1/confirm").status_code == 404
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_ai_items.py -v`
Expected: FAIL — routes don't exist (404 for all, including the ones expecting 200).

- [ ] **Step 3: Implement the views**

Create `backend/apps/profiles/ai_item_views.py`:
```python
"""Per-item review actions on AI-backfilled profile items (ai_-id items only).

Items are addressed by their unique ai_ id; the server locates the item across
the four backfilled array fields. All actions are owner-scoped via the JWT user.
"""
from django.utils import timezone as djtz
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.jobs import profile_logic as pl

from .models import UserProfile

AI_FIELDS = ["allergies", "medications", "medical_history", "surgical_history"]

# Detail (non-key) fields editable per array field. The first tuple element is
# the normalized-key field, which may NOT be edited here.
KEY_FIELD = {"allergies": "allergen", "medications": "name",
             "medical_history": "condition", "surgical_history": "procedure"}
DETAIL_FIELDS = {
    "allergies": {"reaction", "severity"},
    "medications": {"dose", "frequency"},
    "medical_history": {"year", "notes"},
    "surgical_history": {"year", "notes"},
}


def _find(profile, item_id):
    for field in AI_FIELDS:
        arr = getattr(profile, field) or []
        for idx, it in enumerate(arr):
            if isinstance(it, dict) and it.get("id") == item_id:
                return field, idx, it
    return None, None, None


class _ItemBase(APIView):
    permission_classes = [IsAuthenticated]

    def get_profile_and_item(self, request, item_id):
        if not pl.is_ai_backfilled(item_id):
            return None, None, None, None
        profile = UserProfile.for_user(request.user)
        field, idx, item = _find(profile, item_id)
        return profile, field, idx, item


class AiItemConfirmView(_ItemBase):
    def post(self, request, item_id):
        profile, field, idx, item = self.get_profile_and_item(request, item_id)
        if item is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        item["review_status"] = "confirmed"
        item["reviewed_at"] = djtz.now().isoformat()
        getattr(profile, field)[idx] = item
        profile.save(update_fields=[field, "updated_at"])
        return Response({"id": item_id, "review_status": "confirmed"})


class AiItemRejectView(_ItemBase):
    def post(self, request, item_id):
        profile, field, idx, item = self.get_profile_and_item(request, item_id)
        if item is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        arr = getattr(profile, field)
        arr.pop(idx)  # leave added_keys intact -> suppression prevents resurfacing
        profile.save(update_fields=[field, "updated_at"])
        return Response({"id": item_id, "rejected": True})


class AiItemEditView(_ItemBase):
    def patch(self, request, item_id):
        profile, field, idx, item = self.get_profile_and_item(request, item_id)
        if item is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        incoming = {k: v for k, v in request.data.items() if k not in ("id",)}
        if KEY_FIELD[field] in incoming:
            return Response(
                {"detail": "Renaming is not supported; reject this item and add it manually."},
                status=status.HTTP_400_BAD_REQUEST)
        allowed = DETAIL_FIELDS[field]
        bad = set(incoming) - allowed
        if bad:
            return Response({"detail": f"Cannot edit: {', '.join(sorted(bad))}."},
                            status=status.HTTP_400_BAD_REQUEST)
        if "ai_original" not in item:
            item["ai_original"] = {k: item.get(k) for k in ({KEY_FIELD[field]} | allowed)}
        item.update(incoming)
        item["review_status"] = "edited"
        item["reviewed_at"] = djtz.now().isoformat()
        getattr(profile, field)[idx] = item
        profile.save(update_fields=[field, "updated_at"])
        return Response(item)


class AiItemSourcesView(_ItemBase):
    def get(self, request, item_id):
        from apps.documents.models import Document
        from apps.documents import provenance
        profile, field, idx, item = self.get_profile_and_item(request, item_id)
        if item is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        cfg = next(c for c in provenance.FIELD_MAP if c.profile_field == field)
        key = cfg.profile_key(item)
        sources = []
        docs = (Document.objects.filter(user=request.user, status=Document.Status.PROCESSED,
                detached_at__isnull=True).exclude(source_type=Document.SourceType.MANUAL_INPUT))
        for d in docs:
            summary = provenance.read_summary(d.summary_path)
            if not summary:
                continue
            facts = (summary.get("key_facts", {}) or {}).get(cfg.doc_field) or []
            if any(isinstance(f, dict) and cfg.doc_key(f) == key for f in facts):
                sources.append({"document_id": str(d.id), "title": d.title})
        return Response({"sources": sources})
```

- [ ] **Step 4: Wire the routes**

Replace `backend/apps/profiles/urls.py` with:
```python
from django.urls import path

from . import views
from .ai_item_views import (
    AiItemConfirmView, AiItemEditView, AiItemRejectView, AiItemSourcesView,
)
from .avatar_views import AvatarView

urlpatterns = [
    path("profile", views.MyProfileView.as_view(), name="my-profile"),
    path("profile/link-health", views.LinkHealthView.as_view(), name="link-health"),
    path("profile/unlink-health", views.UnlinkHealthView.as_view(), name="unlink-health"),
    path("profile/avatar", AvatarView.as_view(), name="avatar"),
    path("profile/ai-items/<str:item_id>/confirm", AiItemConfirmView.as_view(), name="ai-item-confirm"),
    path("profile/ai-items/<str:item_id>/reject", AiItemRejectView.as_view(), name="ai-item-reject"),
    path("profile/ai-items/<str:item_id>/sources", AiItemSourcesView.as_view(), name="ai-item-sources"),
    path("profile/ai-items/<str:item_id>", AiItemEditView.as_view(), name="ai-item-edit"),
]
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_ai_items.py -v`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add backend/apps/profiles/ai_item_views.py backend/apps/profiles/urls.py backend/tests/test_ai_items.py
git commit -m "feat(profiles): per-item confirm/edit/reject/sources endpoints"
```

---

### Task 7: Harden whole-profile PATCH to preserve review metadata

**Files:**
- Modify: `backend/apps/profiles/views.py` (`MyProfileView`)
- Test: `backend/tests/test_api.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_api.py`:
```python
def test_profile_patch_preserves_ai_review_metadata(user, client_for):
    """A whole-profile PATCH that omits server-owned review fields must not wipe them."""
    from apps.profiles.models import UserProfile
    p = UserProfile.for_user(user)
    p.medications = [{"id": "ai_m1", "name": "Metformin", "dose": "500mg",
                      "review_status": "confirmed", "reviewed_at": "2026-06-17T00:00:00Z"}]
    p.save()
    c = client_for(user)
    # Client round-trips arrays WITHOUT the review fields (as today's UI would).
    resp = c.patch("/api/profile",
                   {"medications": [{"id": "ai_m1", "name": "Metformin", "dose": "500mg"}]},
                   format="json")
    assert resp.status_code == 200
    p.refresh_from_db()
    assert p.medications[0]["review_status"] == "confirmed"
    assert p.medications[0]["reviewed_at"] == "2026-06-17T00:00:00Z"


def test_profile_patch_can_still_drop_ai_item(user, client_for):
    from apps.profiles.models import UserProfile
    p = UserProfile.for_user(user)
    p.medications = [{"id": "ai_m1", "name": "Metformin", "review_status": "confirmed"}]
    p.save()
    c = client_for(user)
    resp = c.patch("/api/profile", {"medications": []}, format="json")
    assert resp.status_code == 200
    p.refresh_from_db()
    assert p.medications == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_api.py::test_profile_patch_preserves_ai_review_metadata -v`
Expected: FAIL — `review_status` is gone after the PATCH.

- [ ] **Step 3: Override `perform_update` in `MyProfileView`**

In `backend/apps/profiles/views.py`, add to `MyProfileView`:
```python
class MyProfileView(RetrieveUpdateAPIView):
    """GET/PUT/PATCH the current user's profile (auto-created on first access)."""

    serializer_class = UserProfileSerializer
    permission_classes = [IsAuthenticated]

    AI_FIELDS = ["allergies", "medications", "medical_history", "surgical_history"]
    PRESERVE = ("review_status", "reviewed_at", "ai_original")

    def get_object(self) -> UserProfile:
        return UserProfile.for_user(self.request.user)

    def perform_update(self, serializer):
        from apps.jobs.profile_logic import is_ai_backfilled
        instance = serializer.instance
        before = {
            f: {it.get("id"): it for it in (getattr(instance, f) or [])
                if isinstance(it, dict) and is_ai_backfilled(it.get("id"))}
            for f in self.AI_FIELDS
        }
        obj = serializer.save()
        changed = []
        for f in self.AI_FIELDS:
            arr = getattr(obj, f) or []
            touched = False
            for it in arr:
                if isinstance(it, dict) and is_ai_backfilled(it.get("id")):
                    prev = before[f].get(it.get("id"))
                    if prev:
                        for k in self.PRESERVE:
                            if k in prev and k not in it:
                                it[k] = prev[k]; touched = True
            if touched:
                changed.append(f)
        if changed:
            obj.save(update_fields=[*changed, "updated_at"])
```
(Keep the existing `_HealthLinkBase`, `LinkHealthView`, `UnlinkHealthView` below unchanged. Imports `RetrieveUpdateAPIView`, `IsAuthenticated`, `UserProfile`, `UserProfileSerializer` are already present.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_api.py -k "profile_patch" -v`
Expected: PASS (both)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/profiles/views.py backend/tests/test_api.py
git commit -m "feat(profiles): preserve AI review metadata across whole-profile PATCH"
```

---

### Task 8: Expose unreviewed AI count

**Files:**
- Modify: `backend/apps/profiles/serializers.py`
- Test: `backend/tests/test_api.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_api.py`:
```python
def test_profile_exposes_ai_review_counts(user, client_for):
    from apps.profiles.models import UserProfile
    p = UserProfile.for_user(user)
    p.medications = [{"id": "ai_m1", "name": "A"}, {"id": "ai_m2", "name": "B", "review_status": "confirmed"}]
    p.allergies = [{"id": "manual-1", "allergen": "Nuts"}]
    p.save()
    body = client_for(user).get("/api/profile").json()
    assert body["ai_review"]["total"] == 2       # 2 AI items
    assert body["ai_review"]["unreviewed"] == 1  # m1 unreviewed, m2 confirmed
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_api.py::test_profile_exposes_ai_review_counts -v`
Expected: FAIL — `KeyError: 'ai_review'`

- [ ] **Step 3: Add a computed field to the serializer**

In `backend/apps/profiles/serializers.py`, add to `UserProfileSerializer`:
```python
    ai_review = serializers.SerializerMethodField()

    def get_ai_review(self, obj) -> dict:
        from apps.jobs.profile_logic import is_ai_backfilled
        total = unreviewed = 0
        for f in ("allergies", "medications", "medical_history", "surgical_history"):
            for it in (getattr(obj, f) or []):
                if isinstance(it, dict) and is_ai_backfilled(it.get("id")):
                    total += 1
                    if not it.get("review_status"):
                        unreviewed += 1
        return {"total": total, "unreviewed": unreviewed}
```
Add `ai_review` to a `read_only_fields` entry is unnecessary for a `SerializerMethodField` (it's read-only by nature), but ensure it isn't in `exclude`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_api.py::test_profile_exposes_ai_review_counts -v`
Expected: PASS

- [ ] **Step 5: Run the whole backend suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: PASS (all green, including pre-existing tests)

- [ ] **Step 6: Commit**

```bash
git add backend/apps/profiles/serializers.py backend/tests/test_api.py
git commit -m "feat(profiles): expose ai_review counts on profile"
```

---

## Phase C — Client (Expo)

### Task 9: API client wrappers

**Files:**
- Modify: `src/lib/api/data.ts` (documents + new profile-item section)
- Test: `src/lib/documentReview.test.ts` (new)

- [ ] **Step 1: Add the wrappers**

In `src/lib/api/data.ts`, in the `// --- documents ---` section add:
```typescript
export function getDocumentAnalysis(id: string): Promise<any> {
  return api.get(`/api/documents/${id}/analysis/`);
}
export function getDocumentFile(id: string): Promise<{ url: string | null }> {
  return api.get(`/api/documents/${id}/file/`);
}
export function detachDocument(id: string): Promise<{ removed: Record<string, number>; kept_shared: Record<string, number> }> {
  return api.post(`/api/documents/${id}/detach/`);
}
export function reprocessDocument(id: string): Promise<{ jobId: string; reused: boolean }> {
  return api.post(`/api/documents/${id}/reprocess/`);
}
```
And in the `// --- profile ---` section add:
```typescript
export function confirmAiItem(itemId: string): Promise<any> {
  return api.post(`/api/profile/ai-items/${itemId}/confirm`);
}
export function rejectAiItem(itemId: string): Promise<any> {
  return api.post(`/api/profile/ai-items/${itemId}/reject`);
}
export function editAiItem(itemId: string, patch: Record<string, unknown>): Promise<any> {
  return api.patch(`/api/profile/ai-items/${itemId}`, patch);
}
export function getAiItemSources(itemId: string): Promise<{ sources: { document_id: string; title: string }[] }> {
  return api.get(`/api/profile/ai-items/${itemId}/sources`);
}
```

- [ ] **Step 2: Write the contribution→badge helper + test**

Create `src/lib/documentReview.ts`:
```typescript
// Maps a backend contribution state to user-facing badge text + tone.
export type ContributionState = "unreviewed" | "confirmed" | "edited" | "rejected" | "not_added" | "present";

export type Badge = { label: string; tone: "neutral" | "ok" | "warn" | "muted" };

export function badgeForState(state: ContributionState, origin: "ai" | "manual"): Badge {
  if (origin === "manual") return { label: "From your profile", tone: "muted" };
  switch (state) {
    case "confirmed": return { label: "Confirmed", tone: "ok" };
    case "edited":    return { label: "Edited", tone: "ok" };
    case "rejected":  return { label: "Rejected", tone: "warn" };
    case "not_added": return { label: "Not added", tone: "muted" };
    default:          return { label: "Needs review", tone: "neutral" };
  }
}

// Whether per-item Confirm/Edit/Reject actions apply to this contribution.
export function isActionable(state: ContributionState, origin: "ai" | "manual"): boolean {
  return origin === "ai" && (state === "unreviewed" || state === "confirmed" || state === "edited");
}
```
Create `src/lib/documentReview.test.ts`:
```typescript
import { describe, expect, it } from "vitest";

import { badgeForState, isActionable } from "./documentReview";

describe("badgeForState", () => {
  it("labels reviewed states", () => {
    expect(badgeForState("confirmed", "ai").label).toBe("Confirmed");
    expect(badgeForState("rejected", "ai").tone).toBe("warn");
    expect(badgeForState("unreviewed", "ai").label).toBe("Needs review");
  });
  it("treats manual items distinctly", () => {
    expect(badgeForState("present", "manual").label).toBe("From your profile");
  });
});

describe("isActionable", () => {
  it("is true only for present AI items", () => {
    expect(isActionable("unreviewed", "ai")).toBe(true);
    expect(isActionable("rejected", "ai")).toBe(false);
    expect(isActionable("present", "manual")).toBe(false);
  });
});
```

- [ ] **Step 3: Run the vitest test**

Run: `npx vitest run src/lib/documentReview.test.ts`
Expected: PASS (this project uses vitest, not jest)

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/data.ts src/lib/documentReview.ts src/lib/documentReview.test.ts
git commit -m "feat(client): document review api wrappers + badge helper"
```

---

### Task 10: Register the `DocumentDetail` route

**Files:**
- Modify: `src/navigation/appTypes.ts`
- Modify: `src/navigation/AppNavigator.tsx`

- [ ] **Step 1: Add the route param**

In `src/navigation/appTypes.ts`, add:
```typescript
  DocumentDetail: { id: string; title?: string };
```

- [ ] **Step 2: Register the screen**

In `src/navigation/AppNavigator.tsx`, add the import near the other screen imports:
```typescript
import { DocumentDetailScreen } from "../screens/App/DocumentDetailScreen";
```
And add a `<Stack.Screen>` (place near `ManageDocuments`):
```tsx
      <Stack.Screen
        name="DocumentDetail"
        component={DocumentDetailScreen}
        options={{ title: "Document" }}
      />
```

- [ ] **Step 3: Verify typecheck after the screen exists (Task 11)**

Run: `npx tsc --noEmit` (will pass once Task 11 creates the screen).

- [ ] **Step 4: Commit (after Task 11, bundled)**

(Commit together with Task 11 so the import resolves.)

---

### Task 11: `DocumentDetailScreen`

**Files:**
- Create: `src/screens/App/DocumentDetailScreen.tsx`
- Test: manual (see verification)

**Pattern to follow:** mirror styling/tokens from `src/components/ui/ManageDocuments/ListDocuments.tsx` (`createStyles`, `useTheme`, `AppText`, `BottomSheet`, `spacing`, `radius`, `typescale`). Use `react-native`'s `Linking.openURL` to open the original file URL.

- [ ] **Step 1: Implement the screen**

Create `src/screens/App/DocumentDetailScreen.tsx` with this behavior (complete code):
```tsx
import React, { useCallback, useEffect, useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, Linking, Alert } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../navigation/appTypes";
import { AppText } from "../../components/ui/Primitives/AppText";
import { BottomSheet } from "../../components/ui/Primitives/BottomSheet";
import { useTheme } from "../../context/ThemeContext";
import { createStyles } from "../../theme/createStyles";
import { spacing, radius, typescale } from "../../theme/tokens";
import {
  getDocumentAnalysis, getDocumentFile, detachDocument, reprocessDocument,
  confirmAiItem, rejectAiItem,
} from "../../lib/api/data";
import { badgeForState, isActionable, type ContributionState } from "../../lib/documentReview";

type Props = NativeStackScreenProps<AppStackParamList, "DocumentDetail">;
type Contribution = {
  field: string; label: string; fact: Record<string, any>;
  origin: "ai" | "manual"; state: ContributionState; profile_item_id: string | null;
  ai_original: Record<string, any> | null;
};

const FIELD_TITLES: Record<string, string> = {
  allergies: "Allergies", medications: "Medications",
  medical_history: "Conditions", surgical_history: "Surgeries & procedures",
};

export function DocumentDetailScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const { colors } = useTheme();
  const s = useStyles();
  const [analysis, setAnalysis] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDetach, setConfirmDetach] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setAnalysis(await getDocumentAnalysis(id)); }
    catch (e: any) { setError(e?.message ?? "Could not load analysis."); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function openOriginal() {
    try {
      const { url } = await getDocumentFile(id);
      if (url) Linking.openURL(url);
      else Alert.alert("Unavailable", "The original file could not be opened.");
    } catch { Alert.alert("Unavailable", "The original file could not be opened."); }
  }

  async function onConfirm(itemId: string) {
    setBusyItem(itemId);
    try { await confirmAiItem(itemId); await load(); } finally { setBusyItem(null); }
  }
  async function onReject(itemId: string) {
    setBusyItem(itemId);
    try { await rejectAiItem(itemId); await load(); } finally { setBusyItem(null); }
  }
  async function onDetach() {
    setConfirmDetach(false);
    try { await detachDocument(id); await load(); } catch (e: any) { setError(e?.message ?? "Failed."); }
  }
  async function onReprocess() {
    try { await reprocessDocument(id); navigation.goBack(); }
    catch (e: any) { setError(e?.message ?? "Failed to re-run."); }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={colors.teal} /></View>;
  if (error) return <View style={s.center}><AppText style={s.error}>{error}</AppText></View>;

  const confidence = analysis?.confidence_0_to_1;
  const contribs: Contribution[] = analysis?.contributions ?? [];
  const grouped: Record<string, Contribution[]> = {};
  for (const c of contribs) (grouped[c.field] ??= []).push(c);

  return (
    <ScrollView contentContainerStyle={s.container}>
      <Pressable style={s.openBtn} onPress={openOriginal} accessibilityRole="button">
        <AppText style={s.openBtnText}>View original file</AppText>
      </Pressable>

      {typeof confidence === "number" ? (
        <View style={s.confidenceBox}>
          <AppText style={s.confidenceLabel}>AI confidence: {Math.round(confidence * 100)}%</AppText>
          <AppText style={s.confidenceHint}>Self-reported by the AI — verify against the original.</AppText>
        </View>
      ) : null}

      {Object.keys(FIELD_TITLES).map((field) => {
        const items = grouped[field];
        if (!items?.length) return null;
        return (
          <View key={field} style={s.section}>
            <AppText style={s.sectionTitle}>{FIELD_TITLES[field]}</AppText>
            {items.map((c, i) => {
              const badge = badgeForState(c.state, c.origin);
              return (
                <View key={`${field}-${i}`} style={s.itemCard}>
                  <View style={s.itemHead}>
                    <AppText style={s.itemLabel}>{c.label}</AppText>
                    <View style={[s.badge, { backgroundColor: toneBg(colors, badge.tone) }]}>
                      <AppText style={[s.badgeText, { color: toneFg(colors, badge.tone) }]}>{badge.label}</AppText>
                    </View>
                  </View>
                  {c.ai_original ? (
                    <AppText style={s.original}>AI originally read: {JSON.stringify(c.ai_original)}</AppText>
                  ) : null}
                  {isActionable(c.state, c.origin) && c.profile_item_id ? (
                    <View style={s.actions}>
                      <Pressable disabled={busyItem === c.profile_item_id}
                        onPress={() => onConfirm(c.profile_item_id!)} style={s.actionConfirm}>
                        <AppText style={s.actionConfirmText}>Confirm</AppText>
                      </Pressable>
                      <Pressable disabled={busyItem === c.profile_item_id}
                        onPress={() => onReject(c.profile_item_id!)} style={s.actionReject}>
                        <AppText style={s.actionRejectText}>Reject</AppText>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        );
      })}

      <View style={s.footer}>
        <Pressable style={s.rerun} onPress={onReprocess} accessibilityRole="button">
          <AppText style={s.rerunText}>Re-run analysis</AppText>
        </Pressable>
        <Pressable style={s.cancel} onPress={() => setConfirmDetach(true)} accessibilityRole="button">
          <AppText style={s.cancelText}>Cancel results</AppText>
        </Pressable>
      </View>

      {confirmDetach ? (
        <BottomSheet visible accent="teal" title="Cancel this document's results?"
          message="Findings this document added to your profile will be removed (shared findings are kept). The file stays in your library, and you can re-run it later."
          onClose={() => setConfirmDetach(false)}>
          <View style={s.sheetRow}>
            <Pressable style={s.sheetSecondary} onPress={() => setConfirmDetach(false)}>
              <AppText style={s.sheetSecondaryText}>Keep</AppText>
            </Pressable>
            <Pressable style={s.sheetPrimary} onPress={onDetach}>
              <AppText style={s.sheetPrimaryText}>Remove results</AppText>
            </Pressable>
          </View>
        </BottomSheet>
      ) : null}
    </ScrollView>
  );
}

function toneBg(c: any, t: string) {
  return t === "ok" ? c.tealSoft : t === "warn" ? c.dangerSoft : t === "neutral" ? c.warnSoft : c.bgSecondary;
}
function toneFg(c: any, t: string) {
  return t === "ok" ? c.teal : t === "warn" ? c.danger : t === "neutral" ? c.warning : c.muted;
}

const useStyles = createStyles((c) => ({
  container: { padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { color: c.danger },
  openBtn: { backgroundColor: c.tealSoft, borderRadius: radius.md, padding: spacing.md, alignItems: "center" },
  openBtnText: { color: c.teal, fontWeight: typescale.weight.semibold },
  confidenceBox: { backgroundColor: c.bgSecondary, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  confidenceLabel: { color: c.text, fontWeight: typescale.weight.semibold },
  confidenceHint: { color: c.muted, fontSize: typescale.size.xs },
  section: { gap: spacing.xs },
  sectionTitle: { color: c.muted, fontWeight: typescale.weight.bold, textTransform: "uppercase",
    fontSize: typescale.size.xs, letterSpacing: 0.8 },
  itemCard: { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
    padding: spacing.md, gap: spacing.xs },
  itemHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  itemLabel: { color: c.text, fontWeight: typescale.weight.semibold, flex: 1 },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { fontSize: typescale.size.xs, fontWeight: typescale.weight.semibold },
  original: { color: c.muted, fontSize: typescale.size.xs },
  actions: { flexDirection: "row", gap: spacing.sm },
  actionConfirm: { backgroundColor: c.tealSoft, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  actionConfirmText: { color: c.teal, fontWeight: typescale.weight.semibold, fontSize: typescale.size.xs },
  actionReject: { backgroundColor: c.bgSecondary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  actionRejectText: { color: c.muted, fontWeight: typescale.weight.semibold, fontSize: typescale.size.xs },
  footer: { gap: spacing.sm, marginTop: spacing.md },
  rerun: { backgroundColor: c.tealSoft, borderRadius: radius.md, padding: spacing.md, alignItems: "center" },
  rerunText: { color: c.teal, fontWeight: typescale.weight.semibold },
  cancel: { borderRadius: radius.md, padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: c.border },
  cancelText: { color: c.muted, fontWeight: typescale.weight.semibold },
  sheetRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  sheetSecondary: { flex: 1, height: 46, borderRadius: radius.md, alignItems: "center", justifyContent: "center",
    backgroundColor: c.bgSecondary, borderWidth: 1, borderColor: c.border },
  sheetSecondaryText: { color: c.textSub, fontWeight: typescale.weight.semibold },
  sheetPrimary: { flex: 1.4, height: 46, borderRadius: radius.md, alignItems: "center", justifyContent: "center",
    backgroundColor: c.teal },
  sheetPrimaryText: { color: "#fff", fontWeight: typescale.weight.bold },
}));
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors in the new screen / navigation). If `BottomSheet` prop names differ, adjust to match `src/components/ui/Primitives/BottomSheet.tsx`.

- [ ] **Step 3: Commit (bundled with Task 10)**

```bash
git add src/screens/App/DocumentDetailScreen.tsx src/navigation/AppNavigator.tsx src/navigation/appTypes.ts
git commit -m "feat(client): DocumentDetail review screen + route"
```

---

### Task 12: Records section — list processed documents and open detail

**Files:**
- Modify: `src/components/ui/ManageDocuments/ListDocuments.tsx`
- Modify: `src/screens/App/ManageDocumentsScreen.tsx` (only if wiring/nav needed)

**Behavior:** the active list keeps excluding processed docs. Add a separate **"Your records"** section that fetches `?status=processed&source_type__ne=manual_input` (use `?status=processed` and filter out `manual_input` client-side, since the filter set exposes `status` and `source_type`). Each record card is tappable → `navigation.navigate("DocumentDetail", { id, title })`. Show a "Results removed" pill when `detached_at` is set.

- [ ] **Step 1: Add a records fetch + section**

In `ListDocuments.tsx`:
1. Extend `DocRow` with `detached_at: string | null`.
2. Add state `const [records, setRecords] = useState<DocRow[]>([]);`.
3. Add a fetch in the existing initial-load effect:
```typescript
      const rec = await listDocuments(`?status=processed&offset=0&limit=50&ordering=-created_at`);
      setRecords(((rec.results ?? []) as DocRow[]).filter((d) => d.source_type !== "manual_input"));
```
4. Render the records under the existing sections (inside the `FlatList` `ListFooterComponent`, or as additional `Row`s). Each record is a `Pressable` that calls the navigation prop. Use the existing `useNavigation` hook:
```typescript
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../../navigation/appTypes";
// inside component:
const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
```
5. Record card (place in `ListFooterComponent`, above the existing `footer`):
```tsx
{records.length > 0 ? (
  <View style={{ gap: spacing.xs, marginTop: spacing.md }}>
    <SectionHeader label="Your records" />
    {records.map((d) => (
      <Pressable key={`rec-${d.id}`} onPress={() => navigation.navigate("DocumentDetail", { id: d.id, title: d.title ?? undefined })}>
        <View style={cardStylesRecord(colors)}>
          <AppText style={{ color: colors.text, fontWeight: typescale.weight.semibold }} numberOfLines={1}>
            {d.title ?? "(untitled)"}
          </AppText>
          <AppText style={{ color: colors.muted, fontSize: typescale.size.xs }}>
            {new Date(d.created_at).toLocaleDateString()} · {d.detached_at ? "Results removed" : "Reviewed in analysis"}
          </AppText>
        </View>
      </Pressable>
    ))}
  </View>
) : null}
```
Add a small style helper near the bottom:
```typescript
function cardStylesRecord(c: any) {
  return { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
           padding: spacing.md, gap: 3 } as const;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Manual verification**

Run the app (`./dev` per repo conventions). Process a document; once it leaves the active list it appears under **Your records**; tapping it opens `DocumentDetail` with the extracted findings + confidence + actions.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/ManageDocuments/ListDocuments.tsx src/screens/App/ManageDocumentsScreen.tsx
git commit -m "feat(client): processed-records section linking to DocumentDetail"
```

---

### Task 13: AI badges + actions on Medical Profile items

**Files:**
- Modify: `src/screens/App/MedicalProfileScreen.tsx`

**Behavior:** for items whose `id` starts with `ai_`, show a small "AI" chip; if `review_status` is unset show a "review" dot. Add inline Confirm / Reject (calling `confirmAiItem` / `rejectAiItem`) and a "source" affordance that calls `getAiItemSources(itemId)` and shows the document titles in a `BottomSheet`/`Alert`. After confirm/reject, refresh the profile.

- [ ] **Step 1: Implement**

In `MedicalProfileScreen.tsx`, where each allergy/medication/condition/surgery row renders:
1. Import `confirmAiItem, rejectAiItem, getAiItemSources` from `../../lib/api/data`.
2. Compute `const isAi = typeof item.id === "string" && item.id.startsWith("ai_");`.
3. Render an `AI` chip and (when `!item.review_status`) a teal dot.
4. Add a small actions row for `isAi` items: **Confirm**, **Reject**, **Source** (the latter calls `getAiItemSources` and presents `sources.map(s => s.title).join(", ")` via `Alert.alert("Source documents", …)`).
5. On confirm/reject success, re-fetch the profile (reuse the screen's existing profile-load function).

(Follow the screen's existing list/row rendering and styling; do not restructure unrelated code.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Manual verification**

In Medical Profile, AI-added items show the "AI" chip + review dot; Confirm clears the dot; Reject removes the item; Source lists the originating document(s).

- [ ] **Step 4: Commit**

```bash
git add src/screens/App/MedicalProfileScreen.tsx
git commit -m "feat(client): AI badges + confirm/reject/source on medical profile items"
```

---

## Phase D — Verification

### Task 14: Full-suite verification

- [ ] **Step 1: Backend suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: all PASS (new + pre-existing).

- [ ] **Step 2: Client tests + typecheck**

Run: `npx vitest run src/lib/documentReview.test.ts && npm run typecheck`
Expected: vitest PASS; typecheck reports **0 `error TS` lines** (the tree was clean at baseline, so any new error is ours to fix).

- [ ] **Step 3: Migration check**

Run: `cd backend && .venv/bin/python manage.py makemigrations --check --dry-run`
Expected: "No changes detected" (the `detached_at` migration from Task 1 is committed).

- [ ] **Step 4: Final commit (if anything pending)**

```bash
git add -A && git commit -m "chore: document provenance & review — verification pass" || true
```

---

## Self-review checklist (run before execution)

- **Spec §2 goal 1 (transparency model):** auto-populate untouched; review is additive → Tasks 6–8, 11–13. ✓
- **Spec §2 goal 2 (document-level provenance):** computed join → Tasks 2, 6 (sources). ✓
- **Spec §2 goal 3 (Confirm/Edit/Reject):** Task 6 + Task 11/13. ✓
- **Spec §2 goal 4 (detach keeps file, protects shared, reversible):** Task 3 (added_keys strip) + Task 4 + Task 5. ✓
- **Spec §2 goal 5 (re-run):** Task 4 reprocess. ✓
- **Spec §2 goal 6 (library):** Task 12. ✓
- **Spec §4.1 (`detached_at`):** Task 1; digest filter Task 5. ✓
- **Spec §4.2 (item review fields, server-owned):** Task 6 (set) + Task 7 (preserve). ✓
- **Spec §5.2 (destroy removes summary + contributions):** Task 4 perform_destroy. ✓
- **Spec §5.6 (unreviewed count):** Task 8. ✓
- **`manual_input` excluded everywhere:** analysis/detach/reprocess (Task 4), records list (Task 12), sources (Task 6). ✓
- **Type consistency:** `ContributionState`, `badgeForState`, `isActionable` defined in Task 9 and used in Task 11; endpoint routes match wrappers in Task 9. ✓
