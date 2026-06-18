"""Per-item review endpoints on AI-backfilled profile items."""
import json
import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone

from apps.documents.models import Document
from apps.profiles.models import UserProfile

User = get_user_model()
PW = "Str0ngPass!23"


@pytest.fixture
def user(db):
    return User.objects.create_user(email="item@example.com", password=PW, email_verified_at=timezone.now())


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
    other = User.objects.create_user(email="evil@example.com", password=PW, email_verified_at=timezone.now())
    api_client.force_authenticate(user=other)
    assert api_client.post("/api/profile/ai-items/ai_m1/confirm").status_code == 404
