"""Audit follow-up: detached documents must not leak into QA/search, and
reprocess must leave a consistent status even when an active job is reused."""
import json
import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone

from apps.documents.models import Document
from apps.jobs.models import AiJob, Embedding

User = get_user_model()
PW = "Str0ngPass!23"


@pytest.fixture
def user(db):
    return User.objects.create_user(email="integ@example.com", password=PW, email_verified_at=timezone.now())


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def _vec(*head):
    v = [0.0] * 768
    for i, x in enumerate(head):
        v[i] = float(x)
    return v


def _write_summary(user_id, doc_id, key_facts):
    key = f"documents/{user_id}/processed/{doc_id}/summary.json"
    if default_storage.exists(key):
        default_storage.delete(key)
    default_storage.save(key, ContentFile(json.dumps({
        "document_id": str(doc_id), "key_facts": {"allergies": [], "medications": [],
        "conditions": [], "surgeries_procedures": [], "implants_devices": [],
        "key_labs_vitals": [], "extra_notes": [], **key_facts},
        "timeline_events": [], "confidence_0_to_1": 0.7}).encode()))
    return key


def test_search_excludes_detached_document_embeddings(user, monkeypatch):
    from apps.jobs import index, embeddings
    active = Document.objects.create(user=user, source_type="pdf", status="processed")
    detached = Document.objects.create(user=user, source_type="pdf", status="processed",
                                       detached_at=timezone.now())
    Embedding.objects.create(user=user, document=active, kind="fact",
                             content="ACTIVE-FACT", vector=_vec(0, 1, 0))
    # Detached doc's embedding is the EXACT nearest match — must still be excluded.
    Embedding.objects.create(user=user, document=detached, kind="fact",
                             content="DETACHED-FACT", vector=_vec(1, 0, 0))
    monkeypatch.setattr(embeddings, "embed", lambda texts, **k: [_vec(1, 0, 0)])
    hits = index.search(user, "anything", k=5)
    contents = [h.content for h in hits]
    assert "DETACHED-FACT" not in contents
    assert "ACTIVE-FACT" in contents


def test_static_qa_context_excludes_detached_docs(user):
    from apps.health.qa_views import _static_qa_context
    active = Document.objects.create(user=user, source_type="pdf", status="processed", title="ActiveDoc")
    active.summary_path = _write_summary(user.id, active.id, {"medications": [{"name": "ActiveDrug"}]})
    active.save()
    detached = Document.objects.create(user=user, source_type="pdf", status="processed",
                                       title="DetachedDoc", detached_at=timezone.now())
    detached.summary_path = _write_summary(user.id, detached.id, {"medications": [{"name": "DetachedDrug"}]})
    detached.save()
    ctx = _static_qa_context(user)
    assert "ActiveDrug" in ctx
    assert "DetachedDrug" not in ctx


def test_reprocess_sets_processing_even_when_job_reused(client, user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed",
                                  detached_at=timezone.now())
    # Pre-existing active job overlapping this doc -> enqueue_processing returns reused=True.
    AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS,
                         status=AiJob.Status.QUEUED, document_ids=[doc.id])
    resp = client.post(f"/api/documents/{doc.id}/reprocess/")
    assert resp.status_code == 202
    assert resp.json()["reused"] is True
    doc.refresh_from_db()
    assert doc.detached_at is None
    assert doc.status == "processing"  # consistent state even on reuse


def test_analysis_marks_detached(client, user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processed",
                                  detached_at=timezone.now())
    doc.summary_path = _write_summary(user.id, doc.id, {"medications": [{"name": "X"}]})
    doc.save()
    # Detached docs remain viewable (the library links to them) but are flagged.
    resp = client.get(f"/api/documents/{doc.id}/analysis/")
    assert resp.status_code == 200
    assert resp.json()["detached"] is True
