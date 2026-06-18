"""Ship-blocker + review-UX + polish backend additions:
eval clears stale profile on empty data, task retry, share revoke on change,
un-reject, confirm-all, edit clears timeline, word-boundary timeline match."""
import json
import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone
from datetime import timedelta

from apps.documents.models import Document
from apps.jobs.models import AiJob
from apps.profiles.models import UserProfile
from apps.health.models import HealthProfile
from apps.timeline.models import TimelineEvent
from apps.shares.models import SharePackage

User = get_user_model()
PW = "Str0ngPass!23"


@pytest.fixture
def user(db):
    return User.objects.create_user(email="feat@example.com", password=PW, email_verified_at=timezone.now())


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def _summary(user_id, doc_id, key_facts):
    key = f"documents/{user_id}/processed/{doc_id}/summary.json"
    if default_storage.exists(key):
        default_storage.delete(key)
    default_storage.save(key, ContentFile(json.dumps({
        "document_id": str(doc_id), "key_facts": {"allergies": [], "medications": [],
        "conditions": [], "surgeries_procedures": [], "implants_devices": [],
        "key_labs_vitals": [], "extra_notes": [], **key_facts},
        "timeline_events": [], "confidence_0_to_1": 0.7}).encode()))
    return key


# ── S1: eval clears a stale HealthProfile when the user removed all data ────────
def test_eval_clears_stale_healthprofile_when_no_data(user):
    from apps.jobs import pipeline
    HealthProfile.objects.create(
        user=user, score=70, score_label="Fair",
        card_json={"major_conditions": ["Cancer"], "current_meds": [], "allergies": []},
        summary_json={"full_summary_markdown": "Has cancer."}, facts_digest={"conditions": [{"name": "Cancer"}]})
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROFILE_EVALUATION, document_ids=[])
    pipeline.run_job(job.id)
    hp = HealthProfile.objects.get(user=user)
    assert hp.card_json.get("major_conditions") == []   # cleared, not stale
    assert "cancer" not in json.dumps(hp.summary_json).lower()
    job.refresh_from_db()
    assert job.status == AiJob.Status.SUCCEEDED


# ── S1b: a transient summary-read failure must NOT clear a valid profile ────────
def test_eval_does_not_clear_on_transient_read_failure(user):
    from apps.jobs import pipeline
    HealthProfile.objects.create(
        user=user, score=70, score_label="Fair",
        card_json={"major_conditions": ["Cancer"], "current_meds": [], "allergies": []},
        summary_json={"full_summary_markdown": "Has cancer."}, facts_digest={"conditions": [{"name": "Cancer"}]})
    # Active processed doc whose summary CANNOT be read (points at a missing object).
    Document.objects.create(user=user, source_type="pdf", status="processed",
                            summary_path=f"documents/{user.id}/processed/missing/summary.json")
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROFILE_EVALUATION, document_ids=[])
    with pytest.raises(Exception):
        pipeline.run_job(job.id)  # raises -> task retries; must NOT clear
    hp = HealthProfile.objects.get(user=user)
    assert hp.card_json.get("major_conditions") == ["Cancer"]  # preserved, not nuked


# ── S2: profile_evaluation task retries transient failures ──────────────────────
def test_profile_evaluation_task_has_retry():
    from apps.jobs.tasks import profile_evaluation_task
    assert profile_evaluation_task.max_retries and profile_evaluation_task.max_retries >= 1


# ── S3: a review action revokes the user's active shares ────────────────────────
@pytest.fixture
def med(user):
    p = UserProfile.for_user(user)
    p.medications = [{"id": "ai_m1", "name": "Metformin", "dose": "500mg"}]
    p.ai_backfill_meta = {"fields": {"medications": {"added_keys": ["metformin"],
        "current_item_ids": ["ai_m1"]}}, "last_backfill_at": ""}
    p.save()
    return p


def test_reject_revokes_active_shares(client, user, med):
    share = SharePackage.objects.create(
        owner=user, token_hash="x" * 64, file_type=SharePackage.FileType.HEALTH_PROFILE,
        expires_at=timezone.now() + timedelta(hours=1), max_views=2, payload_json={"types": [], "pdfs": {}})
    assert client.post("/api/profile/ai-items/ai_m1/reject").status_code == 200
    share.refresh_from_db()
    assert share.revoked is True


# ── R1: un-reject restores a mistakenly rejected item ───────────────────────────
def test_unreject_restores_item(client, user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    doc.summary_path = _summary(user.id, doc.id, {"medications": [{"name": "Metformin", "dose": "500mg"}]})
    doc.save()
    p = UserProfile.for_user(user)
    # Metformin was AI-added then rejected: gone from array, key still in added_keys.
    p.medications = []
    p.ai_backfill_meta = {"fields": {"medications": {"added_keys": ["metformin"],
        "current_item_ids": []}}, "last_backfill_at": ""}
    p.save()
    resp = client.post("/api/profile/ai-items/unreject", {"field": "medications", "key": "metformin"}, format="json")
    assert resp.status_code == 200
    p.refresh_from_db()
    names = [m.get("name") for m in p.medications]
    assert "Metformin" in names                                  # restored from doc facts
    assert "metformin" not in p.ai_backfill_meta["fields"]["medications"]["added_keys"]  # un-suppressed


# ── R2: confirm-all marks every unreviewed finding of a document ────────────────
def test_confirm_all_marks_unreviewed(client, user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    doc.summary_path = _summary(user.id, doc.id,
        {"medications": [{"name": "Metformin"}], "conditions": [{"name": "Asthma"}]})
    doc.save()
    p = UserProfile.for_user(user)
    p.medications = [{"id": "ai_m1", "name": "Metformin"}]
    p.medical_history = [{"id": "ai_c1", "condition": "Asthma"}]
    p.save()
    resp = client.post(f"/api/documents/{doc.id}/confirm-all/")
    assert resp.status_code == 200
    p.refresh_from_db()
    assert p.medications[0]["review_status"] == "confirmed"
    assert p.medical_history[0]["review_status"] == "confirmed"


# ── R1b: un-reject when no active doc has the fact keeps it suppressed ──────────
def test_unreject_without_source_keeps_suppressed(client, user):
    p = UserProfile.for_user(user)
    p.medications = []  # rejected; nothing in any active doc reports it
    p.ai_backfill_meta = {"fields": {"medications": {"added_keys": ["metformin"],
        "current_item_ids": []}}, "last_backfill_at": ""}
    p.save()
    resp = client.post("/api/profile/ai-items/unreject",
                       {"field": "medications", "key": "metformin"}, format="json")
    assert resp.status_code == 200
    assert resp.json()["restored"] is False
    p.refresh_from_db()
    assert p.medications == []
    # Must stay suppressed (added_keys intact) since we couldn't restore it.
    assert "metformin" in p.ai_backfill_meta["fields"]["medications"]["added_keys"]


# ── R3b: reject drops the id from current_item_ids but keeps the suppression key ─
def test_reject_cleans_current_item_ids(client, user, med):
    assert client.post("/api/profile/ai-items/ai_m1/reject").status_code == 200
    med.refresh_from_db()
    fm = med.ai_backfill_meta["fields"]["medications"]
    assert "ai_m1" not in fm["current_item_ids"]
    assert "metformin" in fm["added_keys"]   # still suppressed


# ── P1: timeline match respects word boundaries (no substring false-match) ──────
def test_timeline_match_word_boundary(user):
    from apps.documents import provenance
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    doc.summary_path = _summary(user.id, doc.id, {"conditions": [{"name": "Flu"}]})
    doc.save()
    TimelineEvent.objects.create(user=user, document=doc, source="document_ai", title="Influenza vaccine")
    TimelineEvent.objects.create(user=user, document=doc, source="document_ai", title="Flu diagnosis")
    n = provenance.delete_timeline_for_item(user, "medical_history", {"id": "ai_x", "condition": "Flu"})
    titles = list(TimelineEvent.objects.filter(user=user).values_list("title", flat=True))
    assert "Influenza vaccine" in titles    # 'flu' is NOT a word in 'influenza' -> kept
    assert "Flu diagnosis" not in titles     # 'flu' IS a word here -> removed
    assert n == 1
