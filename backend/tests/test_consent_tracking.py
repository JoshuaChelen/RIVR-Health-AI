"""Tests for Task 5: ConsentRecord model + endpoints."""
import pytest
from django.utils import timezone


@pytest.fixture
def user(db):
    from django.contrib.auth import get_user_model
    User = get_user_model()
    return User.objects.create_user(email="consent@example.com", password="pass", email_verified_at=timezone.now())


def test_consent_created_on_user_registration(db):
    from django.contrib.auth import get_user_model
    from apps.accounts.models import ConsentRecord
    User = get_user_model()
    u = User.objects.create_user(email="newuser@example.com", password="pass", email_verified_at=timezone.now())
    pp = ConsentRecord.objects.filter(user=u, consent_type="privacy_policy").first()
    tos = ConsentRecord.objects.filter(user=u, consent_type="terms_of_service").first()
    assert pp is not None
    assert pp.accepted_at is not None
    assert tos is not None


def test_consent_withdrawal_creates_new_record(user):
    from apps.accounts.models import ConsentRecord
    count_before = ConsentRecord.objects.filter(user=user, consent_type="privacy_policy").count()
    ConsentRecord.objects.create(
        user=user,
        consent_type="privacy_policy",
        withdrawn_at=timezone.now(),
    )
    count_after = ConsentRecord.objects.filter(user=user, consent_type="privacy_policy").count()
    assert count_after == count_before + 1


def test_consent_versioning_multiple_records(user):
    from apps.accounts.models import ConsentRecord
    ConsentRecord.objects.create(user=user, consent_type="marketing", accepted_at=timezone.now(), version_date="2024-01-01")
    ConsentRecord.objects.create(user=user, consent_type="marketing", accepted_at=timezone.now(), version_date="2025-01-01")
    assert ConsentRecord.objects.filter(user=user, consent_type="marketing").count() == 2


def test_consent_status_endpoint(db, api_client):
    from django.contrib.auth import get_user_model
    User = get_user_model()
    u = User.objects.create_user(email="cs@example.com", password="pass", email_verified_at=timezone.now())
    api_client.force_authenticate(user=u)
    resp = api_client.get("/api/auth/consent/status")
    assert resp.status_code == 200
    consents = resp.data["consents"]
    assert any(c["consent_type"] == "privacy_policy" for c in consents)


def test_consent_withdraw_endpoint(db, api_client):
    from django.contrib.auth import get_user_model
    from apps.accounts.models import ConsentRecord
    User = get_user_model()
    u = User.objects.create_user(email="cw@example.com", password="pass", email_verified_at=timezone.now())
    api_client.force_authenticate(user=u)
    resp = api_client.post("/api/auth/consent/withdraw", {"consent_type": "privacy_policy"}, format="json")
    assert resp.status_code == 200
    latest = ConsentRecord.objects.filter(user=u, consent_type="privacy_policy").order_by("-created_at").first()
    assert latest.withdrawn_at is not None


def test_consent_withdraw_invalid_type(db, api_client):
    from django.contrib.auth import get_user_model
    User = get_user_model()
    u = User.objects.create_user(email="bad@example.com", password="pass", email_verified_at=timezone.now())
    api_client.force_authenticate(user=u)
    resp = api_client.post("/api/auth/consent/withdraw", {"consent_type": "nonexistent"}, format="json")
    assert resp.status_code == 400
