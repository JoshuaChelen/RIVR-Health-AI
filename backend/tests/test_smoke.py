import pytest
from django.contrib.auth import get_user_model

User = get_user_model()


def test_healthz(api_client):
    resp = api_client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.django_db
def test_create_user():
    user = User.objects.create_user(email="user@example.com", password="s3cret-pw!")
    assert user.email == "user@example.com"
    assert user.check_password("s3cret-pw!")
    assert user.is_active and not user.is_staff and not user.is_superuser
    assert user.is_email_verified is False


@pytest.mark.django_db
def test_create_superuser():
    admin = User.objects.create_superuser(email="admin@example.com", password="s3cret-pw!")
    assert admin.is_staff and admin.is_superuser


@pytest.mark.django_db
def test_email_required():
    with pytest.raises(ValueError):
        User.objects.create_user(email="", password="x")
