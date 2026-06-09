"""Enqueue service + endpoint tests (no AI pipeline run)."""
import pytest
from django.contrib.auth import get_user_model

from apps.documents.models import Document
from apps.jobs.models import AiJob
from apps.jobs.services import enqueue_processing, enqueue_profile_evaluation

User = get_user_model()
PW = "Str0ngPass!23"


@pytest.fixture
def user(db):
    return User.objects.create_user(email="a@example.com", password=PW)


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def test_enqueue_processing_creates_job_and_marks_docs(user):
    d1 = Document.objects.create(user=user, source_type="file", status="uploaded")
    d2 = Document.objects.create(user=user, source_type="pdf", status="uploaded")
    job, reused = enqueue_processing(user, [d1.id, d2.id])
    assert reused is False and job.job_type == "process_documents"
    assert set(job.document_ids) == {d1.id, d2.id}
    d1.refresh_from_db(); d2.refresh_from_db()
    assert d1.status == "processing" and d2.status == "processing"


def test_enqueue_processing_excludes_manual_input(user):
    manual = Document.objects.create(user=user, source_type="manual_input")
    job, _ = enqueue_processing(user, [manual.id])
    assert job is None  # nothing processable


def test_enqueue_processing_dedupes_on_overlap(user):
    d = Document.objects.create(user=user, source_type="file")
    first, r1 = enqueue_processing(user, [d.id])
    second, r2 = enqueue_processing(user, [d.id])
    assert r1 is False and r2 is True and first.id == second.id


def test_enqueue_profile_evaluation_dedupes(user):
    first, r1 = enqueue_profile_evaluation(user)
    second, r2 = enqueue_profile_evaluation(user)
    assert r1 is False and r2 is True and first.id == second.id


def test_enqueue_endpoint_processing(client, user):
    d = Document.objects.create(user=user, source_type="file")
    resp = client.post("/api/jobs/enqueue", {"documentIds": [str(d.id)]}, format="json")
    assert resp.status_code == 202
    body = resp.json()
    assert body["reused"] is False
    assert AiJob.objects.filter(id=body["jobId"], job_type="process_documents").exists()


def test_enqueue_endpoint_profile_eval(client, user):
    resp = client.post("/api/jobs/enqueue", {"jobType": "profile_evaluation"}, format="json")
    assert resp.status_code == 202
    assert AiJob.objects.filter(id=resp.json()["jobId"], job_type="profile_evaluation").exists()


def test_enqueue_endpoint_no_docs(client):
    assert client.post("/api/jobs/enqueue", {"documentIds": []}, format="json").status_code == 400


def test_enqueue_requires_auth(api_client):
    assert api_client.post("/api/jobs/enqueue", {}, format="json").status_code == 401
