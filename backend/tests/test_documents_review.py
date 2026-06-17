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
