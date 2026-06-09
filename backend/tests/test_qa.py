"""Health Q&A endpoint tests (OpenAI mocked)."""
import pytest
from django.contrib.auth import get_user_model

from apps.jobs import ai_client
from apps.jobs.schemas import QAAnswer

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(email="a@example.com", password="pw")


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
        lambda q, c: QAAnswer(answer="You take Metformin.", sources=[{"title": "Labs", "type": "document"}]),
    )
    resp = client.post("/api/qa", {"question": "What meds am I on?"}, format="json")
    assert resp.status_code == 200
    body = resp.json()
    assert body["answer"] == "You take Metformin."
    assert body["sources"][0]["title"] == "Labs"
