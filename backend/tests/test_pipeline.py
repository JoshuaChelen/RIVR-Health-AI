"""AI pipeline tests with OpenAI mocked (eager, synchronous)."""
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone

from apps.documents.models import Document
from apps.health.models import HealthEvaluation, HealthProfile
from apps.jobs import ai_client, extraction, pipeline
from apps.jobs.models import AiJob
from apps.jobs.schemas import DocumentFacts, HealthEvaluation as HEval
from apps.profiles.models import UserProfile

User = get_user_model()


def fake_evaluation(**over):
    base = {
        "score_0_to_100": 78, "score_label": "Strong", "overview": "ok",
        "highlights": [], "risk_flags": [], "missing_info": [], "suggested_next_steps": [],
        "recommendations": [], "three_by_five_card": {
            "blood_type": "O+", "major_conditions": [], "major_surgeries": [], "current_meds": [],
            "allergies": [], "implants_devices": [], "anticoagulants": [], "anesthesia_notes": [],
            "emergency_contact": {"name": None, "phone": None}, "one_line_summary": "Healthy",
        },
        "full_summary_markdown": "Summary.", "disclaimer": "Informational only.",
    }
    base.update(over)
    return HEval.model_validate(base)


def fake_facts(doc_id, **over):
    base = {
        "document_id": str(doc_id), "title": "Doc",
        "key_facts": {"blood_type": None, "allergies": [], "medications": [{"name": "Metformin"}],
                      "conditions": [{"name": "Diabetes"}], "surgeries_procedures": [],
                      "implants_devices": [], "key_labs_vitals": [], "extra_notes": []},
        "timeline_events": [{"occurred_at": "2024-05-01", "date_precision": "day", "title": "Visit",
                             "tags": [], "data_kv": [{"key": "bp", "value": "120/80"}]}],
        "confidence_0_to_1": 0.9,
    }
    base.update(over)
    return DocumentFacts.model_validate(base)


@pytest.fixture
def user(db):
    return User.objects.create_user(email="a@example.com", password="pw")


@pytest.fixture
def mock_ai(monkeypatch):
    monkeypatch.setattr(ai_client, "evaluate_user_health", lambda *a, **k: fake_evaluation())
    monkeypatch.setattr(extraction, "extract_pdf_text", lambda data: "diabetic patient notes " * 20)


def test_profile_evaluation_creates_health_profile(user, mock_ai):
    UserProfile.objects.create(user=user, medical_history=[{"id": "u1", "condition": "Hypertension"}])
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROFILE_EVALUATION, document_ids=[])
    pipeline.run_job(job.id)
    job.refresh_from_db()
    assert job.status == AiJob.Status.SUCCEEDED
    hp = HealthProfile.objects.get(user=user)
    assert hp.score == 78 and hp.version == "profile_v2"
    assert HealthEvaluation.objects.filter(user=user).count() == 1
    assert hp.sources["job_type"] == "profile_evaluation"


def test_profile_evaluation_no_data_fails_gracefully(user, mock_ai):
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROFILE_EVALUATION, document_ids=[])
    pipeline.run_job(job.id)
    job.refresh_from_db()
    assert job.status == AiJob.Status.FAILED
    assert "evaluatable" in job.error.lower()
    assert not HealthProfile.objects.filter(user=user).exists()


def test_process_documents_full_flow(user, mock_ai, monkeypatch):
    doc = Document.objects.create(user=user, source_type="pdf", status="processing", mime_type="application/pdf")
    doc.pdf_path = default_storage.save(f"documents/{user.id}/x.pdf", ContentFile(b"%PDF-1.4 fake"))
    doc.save()
    monkeypatch.setattr(ai_client, "extract_document_facts", lambda *a, **k: fake_facts(doc.id))
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id])
    pipeline.run_job(job.id)
    job.refresh_from_db(); doc.refresh_from_db()
    assert job.status == AiJob.Status.SUCCEEDED
    assert doc.status == "processed" and doc.summary_path
    assert default_storage.exists(doc.summary_path)
    assert HealthProfile.objects.filter(user=user).exists()
    # timeline event was written from the extracted facts
    assert user.timeline_events.filter(source="document_ai").count() == 1


def test_cancellation_reverts_documents(user, mock_ai):
    doc = Document.objects.create(user=user, source_type="pdf", status="processing")
    job = AiJob.objects.create(
        user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id], cancel_requested=True
    )
    pipeline.run_job(job.id)
    job.refresh_from_db(); doc.refresh_from_db()
    assert job.status == AiJob.Status.CANCELLED
    assert doc.status == "uploaded"


def test_merge_card_manual_allergies_win(user):
    card = {"allergies": ["Latex"], "current_meds": [], "emergency_contact": {"name": None, "phone": None}}
    manual = {"allergies": [{"allergen": "Penicillin"}]}
    raw = {"allergies": [{"id": "u1", "allergen": "Penicillin"}], "emergency_contact_name": "Jane", "emergency_contact_phone": "555"}
    merged = pipeline.merge_card_with_profile(card, manual, raw)
    assert merged["allergies"] == ["Penicillin"]
    assert merged["emergency_contact"] == {"name": "Jane", "phone": "555"}


def test_stale_recovery(user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processing")
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS,
                               status="running", document_ids=[doc.id])
    AiJob.objects.filter(pk=job.pk).update(updated_at=timezone.now() - timedelta(minutes=45))
    assert pipeline.recover_stale_jobs() == 1
    job.refresh_from_db(); doc.refresh_from_db()
    assert job.status == AiJob.Status.FAILED and doc.status == "uploaded"
