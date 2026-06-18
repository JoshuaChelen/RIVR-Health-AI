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
