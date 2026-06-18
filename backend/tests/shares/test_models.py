"""Task 1 tests: PIN lockout fields and audit log model."""
import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.shares.models import ShareAccessLog, SharePackage


@pytest.fixture
def user(db):
    return User.objects.create_user(email="m@example.com", password="pw123")


@pytest.fixture
def pkg(user):
    return SharePackage.objects.create(
        owner=user,
        token_hash="abc123",
        file_type="health_profile",
        expires_at=timezone.now() + timezone.timedelta(hours=1),
    )


@pytest.mark.django_db
def test_pin_locked_until_field_exists(user):
    pkg = SharePackage.objects.create(
        owner=user,
        token_hash="hash1",
        file_type="health_profile",
        expires_at=timezone.now() + timezone.timedelta(hours=1),
    )
    assert hasattr(pkg, "pin_locked_until")
    assert pkg.pin_locked_until is None


@pytest.mark.django_db
def test_share_access_log_model_exists(pkg):
    log = ShareAccessLog.objects.create(
        share_package=pkg,
        action="resolved",
        client_ip="192.168.1.1",
    )
    assert log.share_package_id == pkg.id
    assert log.action == "resolved"
    assert log.client_ip == "192.168.1.1"
    assert log.created_at is not None


@pytest.mark.django_db
def test_access_log_is_immutable(pkg):
    log = ShareAccessLog.objects.create(
        share_package=pkg,
        action="resolved",
        client_ip="1.2.3.4",
    )
    with pytest.raises(ValueError, match="immutable"):
        log.save()


@pytest.mark.django_db
def test_access_log_cannot_be_deleted(pkg):
    log = ShareAccessLog.objects.create(
        share_package=pkg,
        action="resolved",
        client_ip="1.2.3.4",
    )
    with pytest.raises(ValueError, match="cannot be deleted"):
        log.delete()


@pytest.mark.django_db
def test_pin_attempts_constraint(user):
    # pin_attempts <= 30 is enforced at DB level
    pkg = SharePackage.objects.create(
        owner=user,
        token_hash="hash2",
        file_type="health_profile",
        expires_at=timezone.now() + timezone.timedelta(hours=1),
        pin_attempts=30,
    )
    assert pkg.pin_attempts == 30
