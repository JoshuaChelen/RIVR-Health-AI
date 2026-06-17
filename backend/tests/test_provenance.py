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
