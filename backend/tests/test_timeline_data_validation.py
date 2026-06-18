"""Tests that TimelineEvent.data JSONField validates on full_clean()."""
import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.timeline.models import TimelineEvent

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(
        email="tl@example.com", password="pass", email_verified_at=timezone.now()
    )


@pytest.mark.django_db
def test_rejects_raw_extracted_text_key(user):
    event = TimelineEvent(
        user=user, title="Test", source="document_ai",
        data={"raw_extracted_text": "Patient MRN 123456: large block of text"},
    )
    with pytest.raises(ValidationError, match="raw_extracted_text"):
        event.full_clean()


@pytest.mark.django_db
def test_rejects_oversized_value(user):
    event = TimelineEvent(
        user=user, title="Test", source="document_ai",
        data={"notes": "x" * 2001},
    )
    with pytest.raises(ValidationError, match="2000 chars"):
        event.full_clean()


@pytest.mark.django_db
def test_rejects_file_path_in_value(user):
    event = TimelineEvent(
        user=user, title="Test", source="document_ai",
        data={"source_file": "/home/user/patient_data.py"},
    )
    with pytest.raises(ValidationError, match="file path"):
        event.full_clean()


@pytest.mark.django_db
def test_accepts_normal_data(user):
    event = TimelineEvent(
        user=user, title="Blood pressure check", source="manual",
        data={
            "summary": "BP was 120/80",
            "provider": "Dr. Smith",
            "location": "Clinic A",
        },
    )
    event.full_clean()  # should not raise
    event.save()
    assert event.pk is not None


@pytest.mark.django_db
def test_accepts_empty_data(user):
    event = TimelineEvent(user=user, title="Simple event", source="manual", data={})
    event.full_clean()
    event.save()
    assert event.pk is not None


@pytest.mark.django_db
def test_accepts_non_string_values_in_data(user):
    event = TimelineEvent(
        user=user, title="Lab result", source="document_ai",
        data={"count": 42, "flags": [1, 2], "meta": {"key": "value"}},
    )
    event.full_clean()
    event.save()
    assert event.pk is not None
