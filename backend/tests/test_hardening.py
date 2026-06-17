"""Whole-app hardening: upload type validation, avatar validation, error sanitization."""
import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile

User = get_user_model()
PW = "Str0ngPass!23"


@pytest.fixture
def user(db):
    return User.objects.create_user(email="hard@example.com", password=PW)


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def test_document_upload_rejects_non_document_type(client):
    f = SimpleUploadedFile("evil.exe", b"MZ\x90\x00", content_type="application/x-msdownload")
    resp = client.post("/api/documents/upload/", {"file": f, "source_type": "file"}, format="multipart")
    assert resp.status_code == 400


def test_document_upload_accepts_pdf(client):
    f = SimpleUploadedFile("note.pdf", b"%PDF-1.4 hello", content_type="application/pdf")
    resp = client.post("/api/documents/upload/", {"file": f, "source_type": "file"}, format="multipart")
    assert resp.status_code == 201


def test_avatar_rejects_non_image_type(client):
    f = SimpleUploadedFile("x.txt", b"hello", content_type="text/plain")
    assert client.post("/api/profile/avatar", {"image": f}, format="multipart").status_code == 400


def test_avatar_rejects_corrupt_image(client):
    f = SimpleUploadedFile("x.png", b"not really an image", content_type="image/png")
    # content_type passes the prefix check, but PIL can't decode it -> 400 (not 500).
    assert client.post("/api/profile/avatar", {"image": f}, format="multipart").status_code == 400


def test_run_job_sanitizes_error_for_api(user, monkeypatch):
    from apps.jobs import ai_client, pipeline
    from apps.jobs.models import AiJob
    from apps.profiles.models import UserProfile
    UserProfile.objects.create(user=user, medical_history=[{"id": "u1", "condition": "X"}])

    def boom(*a, **k):
        raise ValueError("/Users/secret/path.json leaked PII for Jane Doe")
    monkeypatch.setattr(ai_client, "evaluate_user_health", boom)

    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROFILE_EVALUATION, document_ids=[])
    with pytest.raises(Exception):
        pipeline.run_job(job.id)
    job.refresh_from_db()
    assert job.status == AiJob.Status.FAILED
    assert "secret" not in job.error and "PII" not in job.error  # raw exception not exposed
    assert "went wrong" in job.error.lower()
