"""Task 9: comprehensive security and integration tests for phase-4."""
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.shares.models import ShareAccessLog, SharePackage
from apps.shares.services import create_share, resolve_share, revoke_active_shares


@pytest.fixture
def user(db):
    return User.objects.create_user(email="sec@example.com", password="pw123")


@pytest.mark.django_db
class TestShareSecurityIntegration:

    def test_full_secure_share_lifecycle(self, user):
        """End-to-end: create, resolve, revoke, audit."""
        token, pkg = create_share(user, ["full_summary", "card_3x5"], pin="1234")
        pkg.max_views = 2
        pkg.save()
        assert pkg.pin_hash != ""

        # Successful resolution
        result = resolve_share(token, pin="1234", client_ip="192.168.1.1")
        assert "items" in result
        assert result["items"][0]["expiresIn"] == 60

        # Audit log created
        log = ShareAccessLog.objects.filter(share_package=pkg, action="resolved").first()
        assert log is not None
        assert log.client_ip == "192.168.1.1"

        # Second resolution succeeds
        result = resolve_share(token, pin="1234", client_ip="192.168.1.1")
        assert "items" in result
        pkg.refresh_from_db()
        assert pkg.views_count == 2

        # Third resolution fails (max_views=2)
        result = resolve_share(token, pin="1234", client_ip="192.168.1.1")
        assert result.get("status") == 410
        assert ShareAccessLog.objects.filter(share_package=pkg, action="view_limit_exceeded").exists()

        # Wrong PIN with lockout
        result = resolve_share(token, pin="9999", client_ip="192.168.1.2")
        assert result.get("status") == 401
        pkg.refresh_from_db()
        assert pkg.pin_locked_until is not None

        # Immediate next attempt is locked (regardless of correct PIN)
        result = resolve_share(token, pin="1234", client_ip="192.168.1.2")
        assert result.get("status") == 429
        assert ShareAccessLog.objects.filter(share_package=pkg, action="pin_locked").exists()

        # Revoke
        revoked = revoke_active_shares(user)
        assert revoked >= 1

        # After revoke: 404
        result = resolve_share(token, client_ip="192.168.1.1")
        assert result.get("status") == 404

    pass  # concurrent test is in test_security_concurrent.py (requires transaction=True)

    def test_pin_exponential_backoff(self, user):
        """PIN lockout uses exponential backoff (2^N seconds)."""
        token, pkg = create_share(user, ["full_summary"], pin="1234")

        # First failure: 2^1 = 2 seconds
        resolve_share(token, pin="0000", client_ip="1.1.1.1")
        pkg.refresh_from_db()
        assert pkg.pin_attempts == 1
        lockout1 = pkg.pin_locked_until
        assert lockout1 is not None

        # Force unlock to allow second attempt
        pkg.pin_locked_until = None
        pkg.save()

        # Second failure: 2^2 = 4 seconds
        resolve_share(token, pin="0000", client_ip="1.1.1.1")
        pkg.refresh_from_db()
        assert pkg.pin_attempts == 2
        lockout2 = pkg.pin_locked_until
        assert lockout2 is not None

        # Second lockout should be longer than first
        delta = (lockout2 - lockout1).total_seconds()
        assert delta >= 1, f"Second lockout should be longer, delta={delta}"

    def test_audit_trail_completeness(self, user):
        """All access patterns produce audit log entries."""
        token, pkg = create_share(user, ["full_summary"], pin="1234")

        # Successful resolution
        resolve_share(token, pin="1234", client_ip="2.2.2.2")
        # Wrong PIN
        resolve_share(token, pin="9999", client_ip="3.3.3.3")

        logs = ShareAccessLog.objects.filter(share_package=pkg)
        actions = {log.action for log in logs}
        assert "resolved" in actions
        assert "pin_mismatch" in actions

        ips = {log.client_ip for log in logs}
        assert "2.2.2.2" in ips
        assert "3.3.3.3" in ips


@pytest.mark.django_db
def test_invalid_share_token_logged():
    """Token_invalid for unknown tokens does not crash."""
    result = resolve_share("not-a-real-token", client_ip="9.9.9.9")
    assert result.get("status") == 404
    # No ShareAccessLog row since we have no package reference — this is expected


@pytest.mark.django_db
def test_share_type_validation_rejects_invalid(user):
    with pytest.raises(ValueError, match="Invalid share types"):
        create_share(user, ["full_summary", "fake_type"])


@pytest.mark.django_db
def test_pin_strength_validation(user):
    with pytest.raises(ValueError, match="PIN must be 4\\+"):
        create_share(user, ["full_summary"], pin="123")


@pytest.mark.django_db
def test_revoked_share_returns_404(user):
    token, pkg = create_share(user, ["full_summary"])
    SharePackage.objects.filter(pk=pkg.pk).update(revoked=True)
    result = resolve_share(token, client_ip="1.1.1.1")
    assert result.get("status") == 404


@pytest.mark.django_db
def test_pin_lockout_resets_after_expiry(user):
    """Correct PIN after lockout expires resets attempts."""
    from datetime import timedelta

    token, pkg = create_share(user, ["full_summary"], pin="1234")
    resolve_share(token, pin="0000", client_ip="1.1.1.1")  # fail
    # Force expire the lockout
    SharePackage.objects.filter(pk=pkg.pk).update(
        pin_locked_until=timezone.now() - timedelta(seconds=1)
    )
    result = resolve_share(token, pin="1234", client_ip="1.1.1.1")
    assert "items" in result  # succeeds after lockout expires
    pkg.refresh_from_db()
    assert pkg.pin_attempts == 0
    assert pkg.pin_locked_until is None
