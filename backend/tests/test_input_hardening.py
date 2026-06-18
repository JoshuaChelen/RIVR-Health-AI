"""Phase 1-A input hardening tests."""
import datetime
import io
import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

User = get_user_model()
PW = "Str0ngPass!23"


@pytest.fixture
def user(db):
    return User.objects.create_user(email="hard2@example.com", password=PW, email_verified_at=timezone.now())


@pytest.fixture
def auth_client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


# ── Task 1: Django upload limits ─────────────────────────────────────────────

@pytest.mark.django_db
class TestDjangoUploadLimits:
    def test_file_upload_max_memory_size_set(self):
        assert settings.FILE_UPLOAD_MAX_MEMORY_SIZE > 0
        assert settings.FILE_UPLOAD_MAX_MEMORY_SIZE <= 52_428_800

    def test_data_upload_max_memory_size_set(self):
        assert settings.DATA_UPLOAD_MAX_MEMORY_SIZE > 0
        assert settings.DATA_UPLOAD_MAX_MEMORY_SIZE <= 10_485_760

    def test_data_upload_max_number_fields_set(self):
        assert settings.DATA_UPLOAD_MAX_NUMBER_FIELDS > 0
        assert settings.DATA_UPLOAD_MAX_NUMBER_FIELDS <= 1000

    def test_caches_configured(self):
        assert settings.CACHES is not None
        assert 'default' in settings.CACHES


# ── Task 2/3: File validation ─────────────────────────────────────────────────

@pytest.mark.django_db
class TestDocumentUploadValidation:
    def test_upload_rejects_oversized_file(self, auth_client):
        from unittest.mock import patch
        # Patch validate_file_size inside the validation module (imported locally in view)
        with patch('apps.documents.validation.validate_file_size', return_value=(False, "File size exceeds 50MB limit.")):
            f = SimpleUploadedFile("big.pdf", b"%PDF-1.4\nhello", content_type="application/pdf")
            resp = auth_client.post("/api/documents/upload/", {"file": f, "source_type": "file"}, format="multipart")
        assert resp.status_code == 413

    def test_upload_rejects_spoofed_content_type(self, auth_client):
        # MZ header (Windows executable) with PDF content type
        f = SimpleUploadedFile("evil.pdf", b"MZ\x90\x00\x03\x00\x00\x00", content_type="application/pdf")
        resp = auth_client.post("/api/documents/upload/", {"file": f, "source_type": "file"}, format="multipart")
        assert resp.status_code == 400

    def test_upload_accepts_valid_pdf(self, auth_client):
        f = SimpleUploadedFile("test.pdf", b"%PDF-1.4\nhello world", content_type="application/pdf")
        resp = auth_client.post("/api/documents/upload/", {"file": f, "source_type": "file"}, format="multipart")
        assert resp.status_code == 201

    def test_riff_avi_rejected_as_audio(self):
        from apps.documents.validation import validate_file_magic_bytes
        # RIFF container carrying AVI video — must NOT pass the audio allow-list.
        avi = io.BytesIO(b"RIFF" + b"\x00\x00\x00\x00" + b"AVI " + b"LIST")
        ok, _ = validate_file_magic_bytes(avi)
        assert ok is False

    def test_riff_wave_accepted_as_audio(self):
        from apps.documents.validation import validate_file_magic_bytes
        wav = io.BytesIO(b"RIFF" + b"\x24\x00\x00\x00" + b"WAVE" + b"fmt ")
        ok, _ = validate_file_magic_bytes(wav)
        assert ok is True


# ── Task 4: Profile field bounds ──────────────────────────────────────────────

@pytest.mark.django_db
class TestProfileFieldBounds:
    def test_current_symptoms_max_length(self, auth_client):
        resp = auth_client.patch("/api/profile", {"current_symptoms": "x" * 5001}, format="json")
        assert resp.status_code == 400

    def test_allergies_array_size_via_api(self, auth_client):
        allergies = [{"name": f"allergy_{i}"} for i in range(51)]
        resp = auth_client.patch("/api/profile", {"allergies": allergies}, format="json")
        assert resp.status_code == 400

    def test_medications_array_size_via_api(self, auth_client):
        meds = [{"name": f"med_{i}"} for i in range(101)]
        resp = auth_client.patch("/api/profile", {"medications": meds}, format="json")
        assert resp.status_code == 400

    def test_profile_array_orm_validation(self, user):
        from apps.profiles.models import UserProfile
        profile = UserProfile.for_user(user)
        profile.allergies = [{"name": f"allergy_{i}"} for i in range(51)]
        with pytest.raises(ValidationError):
            profile.full_clean()

    def test_array_item_size_cap(self, auth_client):
        # A single giant array item must be rejected (one item can't bloat a row).
        big_item = [{"name": "Penicillin", "notes": "x" * 6000}]
        resp = auth_client.patch("/api/profile", {"allergies": big_item}, format="json")
        assert resp.status_code == 400


# ── Task 5: HTML/control-char validation ─────────────────────────────────────

@pytest.mark.django_db
class TestTextValidation:
    def test_profile_current_symptoms_rejects_html(self, auth_client):
        resp = auth_client.patch("/api/profile", {"current_symptoms": "<script>alert(1)</script>"}, format="json")
        assert resp.status_code == 400

    def test_profile_current_symptoms_accepts_ampersand(self, auth_client):
        # & is legitimate medical text ("Ear, Nose & Throat") — not an HTML vector.
        resp = auth_client.patch("/api/profile", {"current_symptoms": "Ear, Nose & Throat issues"}, format="json")
        assert resp.status_code == 200

    def test_timeline_title_accepts_ampersand(self, auth_client):
        resp = auth_client.post(
            "/api/timeline-events/",
            {"title": "Asthma & allergies review", "occurred_at": "2024-01-01"},
            format="json",
        )
        assert resp.status_code == 201

    def test_timeline_title_rejects_control_chars(self, auth_client):
        resp = auth_client.post(
            "/api/timeline-events/",
            {"title": "test\x00null", "occurred_at": "2024-01-01"},
            format="json",
        )
        assert resp.status_code == 400

    def test_timeline_summary_rejects_html(self, auth_client):
        resp = auth_client.post(
            "/api/timeline-events/",
            {"title": "Normal title", "summary": "<img src=x onerror=alert(1)>", "occurred_at": "2024-01-01"},
            format="json",
        )
        assert resp.status_code == 400

    def test_timeline_title_accepts_normal_text(self, auth_client):
        resp = auth_client.post(
            "/api/timeline-events/",
            {"title": "Lab results visit", "occurred_at": "2024-01-01"},
            format="json",
        )
        assert resp.status_code == 201


# ── Task 7: Throttle tests ────────────────────────────────────────────────────

TIGHT_RATES = {
    "register": "3/min",
    "login": "3/min",
    "password_reset": "3/min",
    "share_resolve": "1000/min",
    "upload": "3/min",
    "qa_calls": "3/min",
}


@pytest.mark.django_db
class TestAuthThrottles:
    def test_register_throttled(self):
        from django.core.cache import cache
        from unittest.mock import patch
        from rest_framework.throttling import SimpleRateThrottle
        cache.clear()
        # Patch THROTTLE_RATES directly since override_settings doesn't update the
        # class-level attribute that was bound at module import time.
        with patch.object(SimpleRateThrottle, 'THROTTLE_RATES', TIGHT_RATES):
            client = APIClient()
            for i in range(4):
                resp = client.post(
                    '/api/auth/register',
                    {'email': f'throttle_reg_{i}@ex.com', 'password': 'Secure123!', 'password_confirm': 'Secure123!'},
                    format='json',
                    REMOTE_ADDR='10.0.11.1',
                )
                if i < 3:
                    assert resp.status_code in (201, 400), f"req {i}: {resp.status_code}"
                else:
                    assert resp.status_code == 429, f"req {i} should be throttled: {resp.status_code}"

    def test_login_throttled(self):
        from django.core.cache import cache
        from unittest.mock import patch
        from rest_framework.throttling import SimpleRateThrottle
        cache.clear()
        User.objects.create_user(email='throttle_login@ex.com', password='pass')
        with patch.object(SimpleRateThrottle, 'THROTTLE_RATES', TIGHT_RATES):
            client = APIClient()
            for i in range(4):
                resp = client.post(
                    '/api/auth/login',
                    {'email': 'throttle_login@ex.com', 'password': 'wrong'},
                    format='json',
                    REMOTE_ADDR='10.0.12.1',
                )
                if i < 3:
                    assert resp.status_code in (400, 401, 422), f"req {i}: {resp.status_code}"
                else:
                    assert resp.status_code == 429, f"req {i} should be throttled: {resp.status_code}"

    def test_password_reset_throttled(self):
        from django.core.cache import cache
        from unittest.mock import patch
        from rest_framework.throttling import SimpleRateThrottle
        cache.clear()
        User.objects.create_user(email='throttle_reset@ex.com', password='pass')
        with patch.object(SimpleRateThrottle, 'THROTTLE_RATES', TIGHT_RATES):
            client = APIClient()
            for i in range(4):
                resp = client.post(
                    '/api/auth/password/forgot',
                    {'email': 'throttle_reset@ex.com'},
                    format='json',
                    REMOTE_ADDR='10.0.13.1',
                )
                if i < 3:
                    assert resp.status_code == 200, f"req {i}: {resp.status_code}"
                else:
                    assert resp.status_code == 429, f"req {i} should be throttled: {resp.status_code}"

    def test_upload_throttled(self):
        # UploadThrottle is per-user; isolate with a dedicated user + cache clear.
        from django.core.cache import cache
        from unittest.mock import patch
        from rest_framework.throttling import SimpleRateThrottle
        cache.clear()
        u = User.objects.create_user(email='throttle_upload@ex.com', password=PW, email_verified_at=timezone.now())
        with patch.object(SimpleRateThrottle, 'THROTTLE_RATES', TIGHT_RATES):
            client = APIClient()
            client.force_authenticate(user=u)
            for i in range(4):
                f = SimpleUploadedFile(f"doc{i}.pdf", b"%PDF-1.4\nhello", content_type="application/pdf")
                resp = client.post("/api/documents/upload/", {"file": f, "source_type": "file"}, format="multipart")
                if i < 3:
                    assert resp.status_code == 201, f"req {i}: {resp.status_code}"
                else:
                    assert resp.status_code == 429, f"req {i} should be throttled: {resp.status_code}"

    def test_qa_throttled(self):
        # QAThrottle is per-user; runs before the view body so it 429s even with
        # no OPENAI key (un-throttled requests would otherwise return 503).
        from django.core.cache import cache
        from unittest.mock import patch
        from rest_framework.throttling import SimpleRateThrottle
        cache.clear()
        u = User.objects.create_user(email='throttle_qa@ex.com', password=PW, email_verified_at=timezone.now())
        with patch.object(SimpleRateThrottle, 'THROTTLE_RATES', TIGHT_RATES):
            client = APIClient()
            client.force_authenticate(user=u)
            statuses = []
            for i in range(4):
                resp = client.post('/api/qa', {'question': 'how am I?'}, format='json')
                statuses.append(resp.status_code)
            # First 3 reach the view (503 — AI not configured), 4th is throttled.
            assert statuses[:3] == [503, 503, 503], statuses
            assert statuses[3] == 429, statuses


# ── Task 8: Timeline limits ───────────────────────────────────────────────────

@pytest.mark.django_db
class TestTimelineLimits:
    def test_bulk_create_rejects_over_100(self, auth_client):
        events = [{"title": f"event {i}", "occurred_at": "2024-01-01"} for i in range(101)]
        resp = auth_client.post("/api/timeline-events/", events, format="json")
        assert resp.status_code == 400
        assert "100" in resp.json().get("detail", "")

    def test_bulk_create_accepts_100(self, auth_client):
        events = [{"title": f"event {i}", "occurred_at": "2024-01-01"} for i in range(100)]
        resp = auth_client.post("/api/timeline-events/", events, format="json")
        assert resp.status_code == 201

    def test_tags_max_20(self, auth_client):
        tags = [f"tag_{i}" for i in range(21)]
        resp = auth_client.post(
            "/api/timeline-events/",
            {"title": "Tagged event", "tags": tags, "occurred_at": "2024-01-01"},
            format="json",
        )
        assert resp.status_code == 400

    def test_summary_max_length(self, auth_client):
        resp = auth_client.post(
            "/api/timeline-events/",
            {"title": "Summary test", "summary": "x" * 2001, "occurred_at": "2024-01-01"},
            format="json",
        )
        assert resp.status_code == 400


# ── Task 9: Pagination ────────────────────────────────────────────────────────

class TestPaginationConfig:
    def test_pagination_max_limit_configured(self):
        from apps.common.pagination import LimitedLimitOffsetPagination
        assert LimitedLimitOffsetPagination.max_limit == 100
        assert LimitedLimitOffsetPagination.default_limit == 30


# ── Task 10: AI item payload size ─────────────────────────────────────────────

@pytest.mark.django_db
class TestAiItemPayloadSize:
    def test_ai_item_edit_rejects_oversized_payload(self, auth_client, user):
        from apps.profiles.models import UserProfile
        profile = UserProfile.for_user(user)
        profile.medications = [{"id": "ai_m999", "name": "Metformin", "dose": "500mg"}]
        profile.ai_backfill_meta = {"fields": {"medications": {"added_keys": ["metformin"],
            "current_item_ids": ["ai_m999"]}}, "last_backfill_at": ""}
        profile.save()
        # Send a 10KB dose value
        resp = auth_client.patch(
            "/api/profile/ai-items/ai_m999",
            {"dose": "x" * 10000},
            format="json",
        )
        assert resp.status_code == 400


# ── Task 11: QA context bounds ────────────────────────────────────────────────

@pytest.mark.django_db
class TestQAContextBounds:
    def test_static_qa_context_respects_total_cap(self):
        from apps.health.qa_views import _static_qa_context
        from apps.timeline.models import TimelineEvent
        user = User.objects.create_user(email='qa_bounds@test.com', password='pw')
        for i in range(50):
            TimelineEvent.objects.create(
                user=user,
                title='x' * 200,
                occurred_at=datetime.date(2024, 1, 1),
            )
        ctx = _static_qa_context(user)
        assert len(ctx) <= 30000


# ── Task 12: Extraction caps ──────────────────────────────────────────────────

class TestExtractionCaps:
    def test_extract_char_cap_exists(self):
        from apps.jobs.ai_client import EXTRACT_CHAR_CAP
        assert EXTRACT_CHAR_CAP == 180_000

    def test_assess_text_quality_handles_very_long_input(self):
        from apps.jobs.extraction import assess_text_quality
        result = assess_text_quality('a' * 200000)
        assert isinstance(result, dict)
        assert 'score' in result
