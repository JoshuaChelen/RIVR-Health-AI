"""Health Q&A endpoint tests (OpenAI mocked)."""
import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.jobs import ai_client
from apps.jobs.schemas import QAAnswer

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(email="a@example.com", password="pw", email_verified_at=timezone.now())


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def test_qa_requires_auth(api_client):
    assert api_client.post("/api/qa", {"question": "hi"}, format="json").status_code == 401


def test_qa_empty_question(client):
    assert client.post("/api/qa", {"question": "  "}, format="json").status_code == 400


def test_qa_not_configured_returns_503(client):
    # OPENAI_API_KEY defaults to "" in tests.
    assert client.post("/api/qa", {"question": "What meds am I on?"}, format="json").status_code == 503


def test_qa_returns_answer_and_sources(client, settings, monkeypatch):
    settings.OPENAI_API_KEY = "test-key"
    monkeypatch.setattr(
        ai_client,
        "answer_health_question",
        lambda q, c, history=None: QAAnswer(answer="You take Metformin.", sources=[{"title": "Labs", "type": "document"}]),
    )
    resp = client.post("/api/qa", {"question": "What meds am I on?"}, format="json")
    assert resp.status_code == 200
    body = resp.json()
    assert body["answer"] == "You take Metformin."
    assert body["sources"][0]["title"] == "Labs"


def test_qa_context_uses_retrieval(db, monkeypatch):
    from django.contrib.auth import get_user_model
    from apps.jobs import index
    from apps.jobs.models import Embedding
    from apps.health import qa_views
    user = get_user_model().objects.create_user(email="qa2@example.com", password="pw")
    Embedding.objects.create(user=user, kind="doc_chunk", content="patient has chronic hypertension", vector=[0.0] * 768)
    monkeypatch.setattr(index, "search", lambda u, q, k=12: list(Embedding.objects.filter(user=u)))
    ctx, sources = qa_views.build_qa_context(user, "tell me about blood pressure")
    assert "chronic hypertension" in ctx
    assert sources and "hypertension" in sources[0]["detail"]


def test_qa_context_falls_back_when_search_errors(db, monkeypatch):
    from django.contrib.auth import get_user_model
    from apps.jobs import index
    from apps.health import qa_views
    user = get_user_model().objects.create_user(email="qa3@example.com", password="pw")
    def _boom(*a, **k): raise RuntimeError("embedder down")
    monkeypatch.setattr(index, "search", _boom)
    ctx, sources = qa_views.build_qa_context(user, "anything")
    assert isinstance(ctx, str)  # fell back to the static slice, did not raise
    assert sources == []
