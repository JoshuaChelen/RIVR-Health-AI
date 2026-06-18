"""Tests that exception text stored to AiJobEvent and Document is sanitized."""
import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.documents.models import Document
from apps.jobs.models import AiJob, AiJobEvent
from apps.jobs.pipeline import _log

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(email="pipe@example.com", password="pass", email_verified_at=timezone.now())


@pytest.fixture
def job(user):
    return AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS)


@pytest.mark.django_db
def test_log_with_ssn_in_data_is_sanitized(job):
    """AiJobEvent.data['detail'] written via _log must not contain SSN."""
    _log(job, "error", "Processing failed", {"detail": "SSN 123-45-6789 found"})
    event = AiJobEvent.objects.filter(job=job).last()
    assert event is not None
    assert "123-45-6789" not in (event.data or {}).get("detail", "")
    assert "[SSN]" in (event.data or {}).get("detail", "")


@pytest.mark.django_db
def test_log_with_email_in_data_is_sanitized(job):
    """AiJobEvent.data['detail'] must not contain raw email."""
    _log(job, "error", "Processing failed", {"detail": "Error for patient@hospital.com"})
    event = AiJobEvent.objects.filter(job=job).last()
    assert event is not None
    assert "patient@hospital.com" not in (event.data or {}).get("detail", "")


@pytest.mark.django_db
def test_log_with_file_path_in_data_is_sanitized(job):
    """AiJobEvent.data must not contain raw file paths."""
    _log(job, "error", "Processing failed", {"detail": "Error in /home/rivr/backend/app.py:42"})
    event = AiJobEvent.objects.filter(job=job).last()
    assert event is not None
    detail = (event.data or {}).get("detail", "")
    assert "/home/rivr/backend/app.py" not in detail


@pytest.mark.django_db
def test_document_processing_error_sanitized_on_save(user):
    """Document.processing_error is sanitized when the model is saved."""
    doc = Document(
        user=user,
        title="Test",
        status=Document.Status.FAILED,
        source_type=Document.SourceType.FILE,
        processing_error="Error for patient@clinic.com in /app/backend/main.py",
    )
    doc.save()
    doc.refresh_from_db()
    assert "patient@clinic.com" not in doc.processing_error
    assert "/app/backend/main.py" not in doc.processing_error


@pytest.mark.django_db
def test_document_processing_error_empty_preserved(user):
    """Empty processing_error should remain empty."""
    doc = Document(
        user=user,
        title="Test",
        status=Document.Status.PROCESSED,
        source_type=Document.SourceType.FILE,
        processing_error="",
    )
    doc.save()
    doc.refresh_from_db()
    assert doc.processing_error == ""
