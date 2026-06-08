"""Core API tests: ownership isolation, filters, profile/health/jobs behaviour."""
import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.documents.models import Document
from apps.health.models import HealthEvaluation, HealthProfile
from apps.jobs.models import AiJob
from apps.timeline.models import TimelineEvent

User = get_user_model()
PW = "Str0ngPass!23"


@pytest.fixture
def user(db):
    return User.objects.create_user(email="a@example.com", password=PW)


@pytest.fixture
def other(db):
    return User.objects.create_user(email="b@example.com", password=PW)


@pytest.fixture
def client_for(api_client):
    def _login(user):
        api_client.force_authenticate(user=user)
        return api_client

    return _login


# --- profile -----------------------------------------------------------------
def test_profile_auto_created_and_updatable(user, client_for):
    c = client_for(user)
    resp = c.get("/api/profile")
    assert resp.status_code == 200
    assert resp.json()["first_name"] == ""
    resp = c.patch("/api/profile", {"first_name": "Ada", "allergies": [{"id": "1", "allergen": "Nuts"}]}, format="json")
    assert resp.status_code == 200
    assert resp.json()["first_name"] == "Ada"
    assert resp.json()["allergies"][0]["allergen"] == "Nuts"


def test_profile_optional_text_fields_accept_null(user, client_for):
    # The mobile onboarding/profile screens send null for empty optional text
    # fields; those map to blank=True/null=False CharFields. null must be coerced
    # to "" instead of failing with "This field may not be null." (400).
    c = client_for(user)
    resp = c.patch(
        "/api/profile",
        {"email": None, "mobile_phone": None, "occupation": None, "marital_status": None,
         "number_of_children": None},
        format="json",
    )
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["email"] == "" and body["mobile_phone"] == ""
    assert body["occupation"] == "" and body["marital_status"] == ""
    assert body["number_of_children"] is None  # genuinely nullable, stays null


def test_link_unlink_health(user, client_for):
    c = client_for(user)
    assert c.post("/api/profile/link-health").json()["health_linked_at"] is not None
    assert c.post("/api/profile/unlink-health").json()["health_linked_at"] is None


def test_profile_requires_auth(api_client):
    assert api_client.get("/api/profile").status_code == 401


# --- ownership isolation (replaces RLS) --------------------------------------
def test_documents_are_owner_scoped(user, other, client_for):
    Document.objects.create(user=user, title="mine", source_type="file")
    other_doc = Document.objects.create(user=other, title="theirs", source_type="file")
    c = client_for(user)
    listing = c.get("/api/documents/").json()
    assert listing["count"] == 1
    assert listing["results"][0]["title"] == "mine"
    # cannot read or delete another user's document -> 404 (no existence leak)
    assert c.get(f"/api/documents/{other_doc.id}/").status_code == 404
    assert c.delete(f"/api/documents/{other_doc.id}/").status_code == 404


def test_document_create_stamps_owner(user, client_for):
    c = client_for(user)
    resp = c.post("/api/documents/", {"title": "scan", "source_type": "pdf"}, format="json")
    assert resp.status_code == 201
    assert Document.objects.get(id=resp.json()["id"]).user_id == user.id


def test_document_filters(user, client_for):
    Document.objects.create(user=user, title="u", status="uploaded", source_type="file")
    Document.objects.create(user=user, title="p", status="processed", source_type="file", processed_at=timezone.now())
    c = client_for(user)
    assert c.get("/api/documents/?status=uploaded").json()["count"] == 1
    assert c.get("/api/documents/?exclude_status=processed").json()["count"] == 1
    assert c.get("/api/documents/?status__in=uploaded,processed").json()["count"] == 2
    assert c.get("/api/documents/?has_processed_at=true").json()["count"] == 1


# --- timeline ----------------------------------------------------------------
def test_timeline_filters_and_bulk_create(user, client_for):
    c = client_for(user)
    bulk = [
        {"title": "Steps", "source": "apple_health", "tags": ["steps"], "data": {"v": 1}},
        {"title": "Visit", "source": "document", "tags": []},
    ]
    assert c.post("/api/timeline-events/", bulk, format="json").status_code == 201
    assert c.get("/api/timeline-events/?exclude_source=apple_health").json()["count"] == 1
    assert c.get("/api/timeline-events/?source=apple_health").json()["count"] == 1


def test_timeline_previsit_toggle_and_expand_document(user, client_for):
    doc = Document.objects.create(user=user, title="Report", source_type="pdf")
    ev = TimelineEvent.objects.create(user=user, document=doc, title="Lab", source="document")
    c = client_for(user)
    detail = c.get(f"/api/timeline-events/{ev.id}/").json()
    assert detail["document_title"] == "Report"
    assert c.patch(f"/api/timeline-events/{ev.id}/", {"included_in_previsit": True}, format="json").status_code == 200
    assert c.get("/api/timeline-events/?included_in_previsit=true").json()["count"] == 1


# --- health ------------------------------------------------------------------
def test_health_profile_read(user, client_for):
    c = client_for(user)
    assert c.get("/api/health-profile").status_code == 404
    HealthProfile.objects.create(user=user, score=82, score_label="Good")
    body = c.get("/api/health-profile").json()
    assert body["score"] == 82 and body["version"] == "profile_v2"


def test_health_evaluations_owner_scoped(user, other, client_for):
    HealthEvaluation.objects.create(user=user, score=70, result={})
    HealthEvaluation.objects.create(user=other, score=30, result={})
    assert client_for(user).get("/api/health-evaluations/").json()["count"] == 1


# --- ai-jobs -----------------------------------------------------------------
def test_ai_jobs_filters_and_cancel(user, client_for):
    doc = Document.objects.create(user=user, source_type="file")
    job = AiJob.objects.create(
        user=user, job_type="process_documents", status="running", document_ids=[doc.id]
    )
    c = client_for(user)
    assert c.get("/api/ai-jobs/?status__in=queued,running").json()["count"] == 1
    assert c.get(f"/api/ai-jobs/?contains_document_id={doc.id}").json()["count"] == 1
    assert c.post(f"/api/ai-jobs/{job.id}/cancel/").status_code == 200
    job.refresh_from_db()
    assert job.cancel_requested is True


def test_ai_jobs_owner_scoped(user, other, client_for):
    AiJob.objects.create(user=other, job_type="process_documents")
    assert client_for(user).get("/api/ai-jobs/").json()["count"] == 0
