"""Phase 2A: allergy/intolerance type subfield."""
import json

import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone

from apps.documents.models import Document
from apps.profiles.models import UserProfile


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(email="intol@example.com", password="Str0ngPass!23", email_verified_at=timezone.now())


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


# ── Task 1: schema + prompt ─────────────────────────────────────────────────
def test_allergy_schema_has_type_default_allergy():
    from apps.jobs.schemas import Allergy
    assert Allergy(substance="Penicillin", severity="high").type == "allergy"
    assert Allergy(substance="Lactose", severity="low", type="intolerance").type == "intolerance"


def test_allergy_schema_rejects_bad_type():
    from apps.jobs.schemas import Allergy
    with pytest.raises(Exception):
        Allergy(substance="X", severity="low", type="nonsense")


# ── Task 2: backfill + eval context ─────────────────────────────────────────
def test_backfill_carries_type():
    from apps.jobs.profile_logic import extract_backfill_candidates
    docs = [{"key_facts": {"allergies": [
        {"substance": "Lactose", "reaction": "GI upset", "severity": "low", "type": "intolerance"},
        {"substance": "Penicillin", "reaction": "Hives", "severity": "high"}]}}]
    by = {a["allergen"]: a for a in extract_backfill_candidates(docs)["allergies"]}
    assert by["Lactose"]["type"] == "intolerance"
    assert by["Penicillin"]["type"] == "allergy"  # default when absent


def test_manual_context_carries_type():
    from apps.jobs.profile_logic import build_manual_profile_context
    ctx = build_manual_profile_context({"allergies": [{"id": "1", "allergen": "Lactose", "type": "intolerance"}]})
    assert ctx["allergies"][0]["type"] == "intolerance"


# ── Task 3: emergency card labeling ─────────────────────────────────────────
def test_card_labels_intolerance():
    from apps.jobs.pipeline import merge_card_with_profile
    manual_ctx = {"allergies": [
        {"allergen": "Penicillin", "type": "allergy"},
        {"allergen": "Lactose", "type": "intolerance"}]}
    merged = merge_card_with_profile({"allergies": ["old"]}, manual_ctx, {"allergies": []})
    assert merged["allergies"] == ["Penicillin", "Lactose (intolerance)"]


# ── Task 4: editable + validated review field ───────────────────────────────
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
    assert client.patch("/api/profile/ai-items/ai_a1", {"type": "nope"}, format="json").status_code == 400


# ── Audit fix: AI-only intolerances must be labeled on the card ─────────────
def test_card_labels_ai_only_intolerance():
    from apps.jobs.pipeline import merge_card_with_profile
    raw_profile = {"allergies": [{"id": "ai_x", "allergen": "Lactose", "type": "intolerance"}]}
    merged = merge_card_with_profile({"allergies": ["Lactose"]}, {}, raw_profile)  # no manual allergies
    assert merged["allergies"] == ["Lactose (intolerance)"]


# ── Audit fix: bad type in doc facts defaults to allergy ────────────────────
def test_backfill_defaults_invalid_type():
    from apps.jobs.profile_logic import extract_backfill_candidates
    docs = [{"key_facts": {"allergies": [{"substance": "X", "severity": "low", "type": "weird"}]}}]
    assert extract_backfill_candidates(docs)["allergies"][0]["type"] == "allergy"


# ── Audit fix: un-reject preserves an allergy's type ────────────────────────
def test_unreject_restores_allergy_type(user):
    from apps.documents.provenance import restore_item_from_docs
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    key = f"documents/{user.id}/processed/{doc.id}/summary.json"
    default_storage.save(key, ContentFile(json.dumps({
        "key_facts": {"allergies": [{"substance": "Lactose", "severity": "low", "type": "intolerance"}],
                      "medications": [], "conditions": [], "surgeries_procedures": [],
                      "implants_devices": [], "key_labs_vitals": [], "extra_notes": []},
        "timeline_events": [], "confidence_0_to_1": 0.5}).encode()))
    doc.summary_path = key; doc.save()
    item = restore_item_from_docs(user, "allergies", "lactose")
    assert item is not None and item["type"] == "intolerance"
