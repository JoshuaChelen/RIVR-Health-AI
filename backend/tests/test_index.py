import pytest
from django.contrib.auth import get_user_model

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(email="emb@example.com", password="pw")


def test_embedding_model_stores_vector(user):
    from apps.jobs.models import Embedding
    e = Embedding.objects.create(user=user, kind="fact", content="Allergy: Penicillin",
                                 vector=[0.0] * 768)
    e.refresh_from_db()
    assert len(list(e.vector)) == 768
    assert e.kind == "fact"


import json as _json
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from apps.documents.models import Document
from apps.jobs.models import Embedding


def _vec(*head):
    v = [0.0] * 768
    for i, x in enumerate(head):
        v[i] = float(x)
    return v


def test_reindex_document_creates_chunk_and_fact_rows(user, monkeypatch):
    from apps.jobs import index, embeddings
    doc = Document.objects.create(user=user, source_type="pdf", status="processed", mime_type="application/pdf", title="Note")
    facts = {"key_facts": {"blood_type": None, "allergies": [{"substance": "Penicillin"}],
             "medications": [{"name": "Metformin"}], "conditions": [], "surgeries_procedures": [],
             "implants_devices": [], "key_labs_vitals": [], "extra_notes": []}}
    doc.summary_path = default_storage.save(f"documents/{user.id}/n.json", ContentFile(_json.dumps(facts).encode()))
    doc.save()
    monkeypatch.setattr(embeddings, "embed", lambda texts, **k: [[0.0] * 768 for _ in texts])
    index.reindex_document(doc, text="long visit note body about the patient")
    rows = Embedding.objects.filter(document=doc)
    assert rows.filter(kind="doc_chunk").exists()
    assert rows.filter(kind="fact").count() == 2  # one allergy + one medication line
    index.reindex_document(doc, text="long visit note body about the patient")
    assert Embedding.objects.filter(document=doc, kind="fact").count() == 2  # re-index replaces


def test_search_returns_nearest_scoped_to_user(user, monkeypatch):
    from apps.jobs import index, embeddings
    other = User.objects.create_user(email="other@example.com", password="pw")
    Embedding.objects.create(user=user, kind="fact", content="aspirin", vector=_vec(1, 0, 0))
    Embedding.objects.create(user=user, kind="fact", content="lisinopril", vector=_vec(0, 1, 0))
    Embedding.objects.create(user=other, kind="fact", content="should-not-leak", vector=_vec(1, 0, 0))
    monkeypatch.setattr(embeddings, "embed", lambda texts, **k: [_vec(1, 0, 0)])
    hits = index.search(user, "what blood thinner", k=5)
    assert hits[0].content == "aspirin"
    assert all(h.user_id == user.id for h in hits)  # cross-user isolation
