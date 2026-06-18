"""Review actions must propagate to derived data: trigger re-eval, drop timeline
events, and keep rejected items out of QA/search."""
import json
import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone

from apps.documents.models import Document
from apps.jobs.models import AiJob, Embedding
from apps.profiles.models import UserProfile
from apps.timeline.models import TimelineEvent

User = get_user_model()
PW = "Str0ngPass!23"
EVAL = AiJob.JobType.PROFILE_EVALUATION


@pytest.fixture
def user(db):
    return User.objects.create_user(email="prop@example.com", password=PW, email_verified_at=timezone.now())


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def _vec(*head):
    v = [0.0] * 768
    for i, x in enumerate(head):
        v[i] = float(x)
    return v


def _write_summary(user_id, doc_id, key_facts):
    key = f"documents/{user_id}/processed/{doc_id}/summary.json"
    if default_storage.exists(key):
        default_storage.delete(key)
    default_storage.save(key, ContentFile(json.dumps({
        "document_id": str(doc_id), "key_facts": {"allergies": [], "medications": [],
        "conditions": [], "surgeries_procedures": [], "implants_devices": [],
        "key_labs_vitals": [], "extra_notes": [], **key_facts},
        "timeline_events": [], "confidence_0_to_1": 0.7}).encode()))
    return key


@pytest.fixture
def med(user):
    p = UserProfile.for_user(user)
    p.medications = [{"id": "ai_m1", "name": "Metformin", "dose": "500mg"}]
    p.ai_backfill_meta = {"fields": {"medications": {"added_keys": ["metformin"],
        "current_item_ids": ["ai_m1"]}}, "last_backfill_at": ""}
    p.save()
    return p


def test_reject_enqueues_profile_evaluation(client, user, med):
    assert not AiJob.objects.filter(user=user, job_type=EVAL).exists()
    assert client.post("/api/profile/ai-items/ai_m1/reject").status_code == 200
    assert AiJob.objects.filter(user=user, job_type=EVAL).exists()


def test_edit_enqueues_profile_evaluation(client, user, med):
    assert client.patch("/api/profile/ai-items/ai_m1", {"dose": "1000mg"}, format="json").status_code == 200
    assert AiJob.objects.filter(user=user, job_type=EVAL).exists()


def test_confirm_does_not_enqueue(client, user, med):
    assert client.post("/api/profile/ai-items/ai_m1/confirm").status_code == 200
    # Confirm changes nothing the evaluation reads — no re-eval needed.
    assert not AiJob.objects.filter(user=user, job_type=EVAL).exists()


def test_detach_enqueues_profile_evaluation(client, user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    doc.summary_path = _write_summary(user.id, doc.id, {"medications": [{"name": "Metformin"}]})
    doc.save()
    assert client.post(f"/api/documents/{doc.id}/detach/").status_code == 200
    assert AiJob.objects.filter(user=user, job_type=EVAL).exists()


def test_reject_deletes_matching_timeline_event(client, user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    doc.summary_path = _write_summary(user.id, doc.id, {"conditions": [{"name": "Cancer"}]})
    doc.save()
    p = UserProfile.for_user(user)
    p.medical_history = [{"id": "ai_c1", "condition": "Cancer"}]
    p.ai_backfill_meta = {"fields": {"medical_history": {"added_keys": ["cancer"],
        "current_item_ids": ["ai_c1"]}}, "last_backfill_at": ""}
    p.save()
    TimelineEvent.objects.create(user=user, document=doc, source="document_ai", title="Cancer Diagnosis")
    TimelineEvent.objects.create(user=user, document=doc, source="document_ai", title="Routine checkup")
    assert client.post("/api/profile/ai-items/ai_c1/reject").status_code == 200
    titles = list(TimelineEvent.objects.filter(user=user).values_list("title", flat=True))
    assert "Cancer Diagnosis" not in titles   # matched + removed
    assert "Routine checkup" in titles         # unrelated event kept


def test_qa_static_context_excludes_suppressed(user):
    from apps.health.qa_views import _static_qa_context
    doc = Document.objects.create(user=user, source_type="pdf", status="processed", title="Doc")
    doc.summary_path = _write_summary(user.id, doc.id,
        {"conditions": [{"name": "Cancer"}], "medications": [{"name": "Aspirin"}]})
    doc.save()
    p = UserProfile.for_user(user)
    p.medical_history = []  # cancer was rejected
    p.ai_backfill_meta = {"fields": {"medical_history": {"added_keys": ["cancer"],
        "current_item_ids": []}}, "last_backfill_at": ""}
    p.save()
    ctx = _static_qa_context(user)
    assert "Cancer" not in ctx
    assert "Aspirin" in ctx


def test_qa_retrieval_excludes_suppressed_embedding(user, monkeypatch):
    from apps.jobs import embeddings
    from apps.health import qa_views
    doc = Document.objects.create(user=user, source_type="pdf", status="processed")
    Embedding.objects.create(user=user, document=doc, kind="fact", content="Condition: Cancer", vector=_vec(1, 0, 0))
    Embedding.objects.create(user=user, document=doc, kind="fact", content="Medication: Aspirin", vector=_vec(0, 1, 0))
    p = UserProfile.for_user(user)
    p.medical_history = []
    p.ai_backfill_meta = {"fields": {"medical_history": {"added_keys": ["cancer"],
        "current_item_ids": []}}, "last_backfill_at": ""}
    p.save()
    monkeypatch.setattr(embeddings, "embed", lambda texts, **k: [_vec(1, 0, 0)])
    ctx, _sources = qa_views.build_qa_context(user, "anything")
    assert "Cancer" not in ctx
