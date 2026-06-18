"""IDOR regression suite — user A cannot read/modify user B's resources.

These tests are canaries: if any cross-user access regresses (e.g. a viewset
loses its get_queryset filter), at least one test here will catch it.
"""
import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status

from apps.documents.models import Document
from apps.health.models import HealthEvaluation, HealthProfile
from apps.jobs.models import AiJob
from apps.timeline.models import TimelineEvent

User = get_user_model()
PW = "Str0ngPass!23"


@pytest.fixture
def user_a(db):
    return User.objects.create_user(
        email="user_a@example.com", password=PW, email_verified_at=timezone.now()
    )


@pytest.fixture
def user_b(db):
    return User.objects.create_user(
        email="user_b@example.com", password=PW, email_verified_at=timezone.now()
    )


@pytest.fixture
def doc_a(user_a):
    return Document.objects.create(user=user_a, title="User A's doc", source_type="file")


@pytest.fixture
def job_a(user_a):
    return AiJob.objects.create(user=user_a, job_type=AiJob.JobType.PROCESS_DOCUMENTS)


@pytest.fixture
def timeline_a(user_a):
    return TimelineEvent.objects.create(
        user=user_a, title="User A's event", source="manual"
    )


@pytest.fixture
def health_eval_a(user_a):
    return HealthEvaluation.objects.create(user=user_a, score=80, result={})


@pytest.fixture
def health_profile_a(user_a):
    return HealthProfile.objects.create(user=user_a, score=90, score_label="Excellent")


@pytest.fixture
def client_b(api_client, user_b):
    api_client.force_authenticate(user=user_b)
    return api_client


@pytest.fixture
def client_a(api_client, user_a):
    api_client.force_authenticate(user=user_a)
    return api_client


# ── Documents ─────────────────────────────────────────────────────────────────

def test_user_b_cannot_read_user_a_document(client_b, doc_a):
    resp = client_b.get(f"/api/documents/{doc_a.id}/")
    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_user_b_cannot_update_user_a_document(client_b, doc_a):
    resp = client_b.patch(f"/api/documents/{doc_a.id}/", {"title": "hacked"}, format="json")
    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_user_b_cannot_delete_user_a_document(client_b, doc_a):
    resp = client_b.delete(f"/api/documents/{doc_a.id}/")
    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_user_b_document_list_does_not_include_user_a_doc(client_b, doc_a):
    resp = client_b.get("/api/documents/")
    assert resp.status_code == status.HTTP_200_OK
    ids = [r["id"] for r in resp.json().get("results", [])]
    assert str(doc_a.id) not in ids


def test_user_a_can_read_own_document(client_a, doc_a):
    resp = client_a.get(f"/api/documents/{doc_a.id}/")
    assert resp.status_code == status.HTTP_200_OK


# ── AI Jobs ───────────────────────────────────────────────────────────────────

def test_user_b_cannot_read_user_a_job(client_b, job_a):
    resp = client_b.get(f"/api/ai-jobs/{job_a.id}/")
    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_user_b_job_list_does_not_include_user_a_job(client_b, job_a):
    resp = client_b.get("/api/ai-jobs/")
    assert resp.status_code == status.HTTP_200_OK
    ids = [r["id"] for r in resp.json().get("results", [])]
    assert str(job_a.id) not in ids


def test_user_b_cannot_cancel_user_a_job(client_b, job_a):
    resp = client_b.post(f"/api/ai-jobs/{job_a.id}/cancel/")
    assert resp.status_code == status.HTTP_404_NOT_FOUND


# ── Timeline Events ───────────────────────────────────────────────────────────

def test_user_b_cannot_read_user_a_timeline_event(client_b, timeline_a):
    resp = client_b.get(f"/api/timeline-events/{timeline_a.id}/")
    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_user_b_cannot_update_user_a_timeline_event(client_b, timeline_a):
    resp = client_b.patch(
        f"/api/timeline-events/{timeline_a.id}/",
        {"title": "hacked"},
        format="json",
    )
    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_user_b_timeline_list_does_not_include_user_a_event(client_b, timeline_a):
    resp = client_b.get("/api/timeline-events/")
    assert resp.status_code == status.HTTP_200_OK
    ids = [r["id"] for r in resp.json().get("results", [])]
    assert str(timeline_a.id) not in ids


# ── Health Evaluations ────────────────────────────────────────────────────────

def test_user_b_cannot_read_user_a_health_evaluation(client_b, health_eval_a):
    resp = client_b.get(f"/api/health-evaluations/{health_eval_a.id}/")
    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_user_b_health_evaluation_list_does_not_include_user_a(client_b, health_eval_a):
    resp = client_b.get("/api/health-evaluations/")
    assert resp.status_code == status.HTTP_200_OK
    ids = [r["id"] for r in resp.json().get("results", [])]
    assert str(health_eval_a.id) not in ids


# ── Health Profile (the "my" endpoint must be self-scoped) ────────────────────

def test_user_b_health_profile_returns_own_not_user_a(client_b, user_b, health_profile_a):
    """user B (no profile) gets 404 — never user A's profile via /api/health-profile."""
    resp = client_b.get("/api/health-profile")
    assert resp.status_code == status.HTTP_404_NOT_FOUND


def test_user_b_health_profile_is_isolated(client_b, user_b, health_profile_a):
    """When user B has their own profile, they see THEIRS, not user A's score."""
    HealthProfile.objects.create(user=user_b, score=10, score_label="Poor")
    resp = client_b.get("/api/health-profile")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["score"] == 10  # user B's score, not user A's 90


def test_user_a_health_profile_returns_own(client_a, health_profile_a):
    resp = client_a.get("/api/health-profile")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["score"] == 90


# ── Shares (token-based; no cross-user enumeration, owner always stamped) ──────

def test_share_create_stamps_authenticated_user_as_owner(client_b, user_a, user_b):
    """A share is always owned by the caller — user B can't create a share for user A."""
    from apps.shares.models import SharePackage
    resp = client_b.post("/api/shares", {"shareTypes": ["full_summary"]}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    pkg = SharePackage.objects.get(id=resp.json()["packageId"])
    assert pkg.owner_id == user_b.id
    assert pkg.owner_id != user_a.id


def test_share_create_requires_authentication(api_client):
    resp = api_client.post("/api/shares", {"shareTypes": ["full_summary"]}, format="json")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


def test_user_b_cannot_resolve_share_without_token(client_b):
    """No endpoint exposes another user's SharePackage by id; resolve needs the token."""
    resp = client_b.post("/api/shares/resolve", {}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


# ── Unauthenticated ───────────────────────────────────────────────────────────

def test_unauthenticated_cannot_list_documents(api_client, doc_a):
    resp = api_client.get("/api/documents/")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


def test_unauthenticated_cannot_list_jobs(api_client, job_a):
    resp = api_client.get("/api/ai-jobs/")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


def test_unauthenticated_cannot_list_timeline(api_client, timeline_a):
    resp = api_client.get("/api/timeline-events/")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED
