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


# ── API-level validation (DRF doesn't call Model.clean(); serializer must) ─────

@pytest.fixture
def api(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


@pytest.mark.django_db
def test_api_post_rejects_markup_in_data(api):
    resp = api.post(
        "/api/timeline-events/",
        {"title": "Visit", "source": "manual", "data": {"note": "<script>alert(1)</script>"}},
        format="json",
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_api_post_rejects_control_chars_in_data(api):
    resp = api.post(
        "/api/timeline-events/",
        {"title": "Visit", "source": "manual", "data": {"note": "bad\x00value"}},
        format="json",
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_api_post_rejects_raw_extracted_text_key(api):
    resp = api.post(
        "/api/timeline-events/",
        {"title": "Visit", "source": "manual", "data": {"raw_extracted_text": "patient data"}},
        format="json",
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_api_post_accepts_legit_structured_data(api):
    resp = api.post(
        "/api/timeline-events/",
        {"title": "Visit", "source": "manual",
         "data": {"summary": "Routine checkup", "provider": "Dr Smith"}},
        format="json",
    )
    assert resp.status_code == 201


@pytest.mark.django_db
def test_api_patch_rejects_markup_in_data(api, user):
    event = TimelineEvent.objects.create(user=user, title="Visit", source="manual", data={})
    resp = api.patch(
        f"/api/timeline-events/{event.id}/",
        {"data": {"note": "<img src=x onerror=alert(1)>"}},
        format="json",
    )
    assert resp.status_code == 400
