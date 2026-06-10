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
