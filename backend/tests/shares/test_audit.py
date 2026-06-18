"""Task 2 tests: audit logging in resolve_share."""
import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.shares.models import ShareAccessLog, SharePackage
from apps.shares.services import create_share, resolve_share


@pytest.fixture
def user(db):
    return User.objects.create_user(email="audit@example.com", password="pw123")


@pytest.mark.django_db
def test_successful_resolution_logged(user):
    token, pkg = create_share(user, ["full_summary"])
    result = resolve_share(token, client_ip="192.168.1.1")
    assert "items" in result
    log = ShareAccessLog.objects.filter(share_package=pkg, action="resolved").first()
    assert log is not None
    assert log.client_ip == "192.168.1.1"


@pytest.mark.django_db
def test_pin_mismatch_logged(user):
    token, pkg = create_share(user, ["full_summary"], pin="1234")
    result = resolve_share(token, pin="9999", client_ip="192.168.1.1")
    assert result.get("status") == 401
    log = ShareAccessLog.objects.filter(share_package=pkg, action="pin_mismatch").first()
    assert log is not None
    assert log.client_ip == "192.168.1.1"
    assert log.pin_attempt == 1


@pytest.mark.django_db
def test_view_limit_exceeded_logged(user, settings):
    settings.SHARE_MAX_VIEWS = 1
    token, pkg = create_share(user, ["full_summary"])
    resolve_share(token, client_ip="192.168.1.1")  # succeeds
    result = resolve_share(token, client_ip="192.168.1.2")  # hits limit
    assert result.get("status") == 410
    assert ShareAccessLog.objects.filter(share_package=pkg, action="view_limit_exceeded").exists()


@pytest.mark.django_db
def test_expired_share_logged(user):
    from datetime import timedelta

    from apps.shares.models import SharePackage

    token, pkg = create_share(user, ["full_summary"])
    SharePackage.objects.filter(pk=pkg.pk).update(expires_at=timezone.now() - timedelta(minutes=5))
    result = resolve_share(token, client_ip="1.2.3.4")
    assert result.get("status") == 410
    assert ShareAccessLog.objects.filter(share_package=pkg, action="expired").exists()


@pytest.mark.django_db
def test_pin_lockout_logged(user):
    token, pkg = create_share(user, ["full_summary"], pin="1234")
    # Trigger lockout with wrong PIN
    resolve_share(token, pin="0000", client_ip="1.1.1.1")
    # Now try again — still locked
    result = resolve_share(token, pin="1234", client_ip="1.1.1.1")
    assert result.get("status") == 429
    assert ShareAccessLog.objects.filter(share_package=pkg, action="pin_locked").exists()
