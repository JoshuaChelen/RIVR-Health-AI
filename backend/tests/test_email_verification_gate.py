"""Email-verification gate tests (Phase 1 Run B).

Unverified authenticated users are 403-blocked from all PHI/data endpoints.
MeView, auth flows, and DeleteAccountView remain accessible to unverified users.
"""
import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

User = get_user_model()
PW = "Str0ngPass!23"


@pytest.fixture
def unverified(db):
    return User.objects.create_user(email="unverified@example.com", password=PW)


@pytest.fixture
def verified(db):
    return User.objects.create_user(
        email="verified@example.com", password=PW, email_verified_at=timezone.now()
    )


@pytest.fixture
def unverified_client(api_client, unverified):
    api_client.force_authenticate(user=unverified)
    return api_client


@pytest.fixture
def verified_client(api_client, verified):
    api_client.force_authenticate(user=verified)
    return api_client


# ── Viewset gate (OwnedModelViewSet) ─────────────────────────────────────────

def test_documents_403_unverified(unverified_client):
    resp = unverified_client.get("/api/documents/")
    assert resp.status_code == 403


def test_documents_200_verified(verified_client):
    resp = verified_client.get("/api/documents/")
    assert resp.status_code == 200


def test_timeline_events_403_unverified(unverified_client):
    resp = unverified_client.get("/api/timeline-events/")
    assert resp.status_code == 403


def test_ai_jobs_403_unverified(unverified_client):
    resp = unverified_client.get("/api/ai-jobs/")
    assert resp.status_code == 403


def test_health_evaluations_403_unverified(unverified_client):
    resp = unverified_client.get("/api/health-evaluations/")
    assert resp.status_code == 403


# ── APIView gate ──────────────────────────────────────────────────────────────

def test_qa_403_unverified(unverified_client):
    resp = unverified_client.post("/api/qa", {"question": "hi"}, format="json")
    assert resp.status_code == 403


def test_profile_403_unverified(unverified_client):
    resp = unverified_client.get("/api/profile")
    assert resp.status_code == 403


def test_profile_200_verified(verified_client):
    resp = verified_client.get("/api/profile")
    assert resp.status_code == 200


def test_link_health_403_unverified(unverified_client):
    resp = unverified_client.post("/api/profile/link-health")
    assert resp.status_code == 403


def test_shares_create_403_unverified(unverified_client):
    resp = unverified_client.post("/api/shares", {"shareTypes": []}, format="json")
    assert resp.status_code == 403


def test_avatar_403_unverified(unverified_client):
    resp = unverified_client.get("/api/profile/avatar")
    assert resp.status_code == 403


def test_ai_item_confirm_403_unverified(unverified_client):
    resp = unverified_client.post("/api/profile/ai-items/ai_m1/confirm")
    assert resp.status_code == 403


def test_ai_item_unreject_403_unverified(unverified_client):
    resp = unverified_client.post("/api/profile/ai-items/unreject", {"field": "medications", "key": "x"}, format="json")
    assert resp.status_code == 403


def test_enqueue_403_unverified(unverified_client):
    resp = unverified_client.post("/api/jobs/enqueue", {"jobType": "profile_evaluation"}, format="json")
    assert resp.status_code == 403


# ── Exempted endpoints (must remain accessible to unverified users) ───────────

def test_me_accessible_to_unverified(unverified_client):
    """Unverified users must be able to hit /me to read is_email_verified=false."""
    resp = unverified_client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["is_email_verified"] is False


def test_delete_account_accessible_to_unverified(unverified_client):
    resp = unverified_client.delete("/api/account")
    assert resp.status_code == 204


# ── ResendVerification endpoint ───────────────────────────────────────────────

def test_resend_verification_unverified(unverified_client, mailoutbox):
    resp = unverified_client.post("/api/auth/verify-email/resend")
    assert resp.status_code == 200
    assert "sent" in resp.json()["detail"].lower()
    assert len(mailoutbox) == 1


def test_resend_verification_already_verified_is_noop(verified_client, mailoutbox):
    resp = verified_client.post("/api/auth/verify-email/resend")
    assert resp.status_code == 200
    assert "already" in resp.json()["detail"].lower()
    assert len(mailoutbox) == 0


def test_resend_verification_requires_auth(api_client):
    resp = api_client.post("/api/auth/verify-email/resend")
    assert resp.status_code == 401
