"""Task 3 tests: get_client_ip and proxy trust validation."""
import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.common.ip import get_client_ip
from apps.shares.models import ShareAccessLog
from apps.shares.services import create_share


# --- Unit tests for get_client_ip ---

class FakeRequest:
    def __init__(self, remote_addr, xff=None):
        self.META = {"REMOTE_ADDR": remote_addr}
        if xff:
            self.META["HTTP_X_FORWARDED_FOR"] = xff


def test_get_client_ip_uses_remote_addr_when_no_trusted_proxies():
    req = FakeRequest("1.2.3.4", xff="203.0.113.1")
    with override_settings(TRUSTED_PROXIES=[]):
        assert get_client_ip(req) == "1.2.3.4"


def test_get_client_ip_extracts_xff_when_proxy_trusted():
    # Caddy appends the real client as the rightmost XFF entry.
    req = FakeRequest("10.0.0.1", xff="1.1.1.1, 203.0.113.1")
    with override_settings(TRUSTED_PROXIES=["10.0.0.1"]):
        assert get_client_ip(req) == "203.0.113.1"


def test_get_client_ip_uses_remote_addr_when_proxy_not_trusted():
    req = FakeRequest("8.8.8.8", xff="203.0.113.1")
    with override_settings(TRUSTED_PROXIES=["10.0.0.1"]):
        assert get_client_ip(req) == "8.8.8.8"


def test_get_client_ip_handles_missing_xff_on_trusted_proxy():
    req = FakeRequest("10.0.0.1")  # no XFF header
    with override_settings(TRUSTED_PROXIES=["10.0.0.1"]):
        assert get_client_ip(req) == "10.0.0.1"


# --- Integration tests: IP flows through to audit log ---

@pytest.mark.django_db
def test_resolve_logs_client_ip_from_x_forwarded_for():
    user = User.objects.create_user(email="iptest@example.com", password="pw123")
    token, pkg = create_share(user, ["full_summary"])
    client = APIClient()
    with override_settings(TRUSTED_PROXIES=["127.0.0.1"]):
        response = client.post(
            "/api/shares/resolve",
            {"token": token},
            # Caddy appends the real client as the rightmost XFF entry; the
            # leftmost "1.1.1.1" is attacker-supplied and must be ignored.
            HTTP_X_FORWARDED_FOR="1.1.1.1, 203.0.113.1",
            REMOTE_ADDR="127.0.0.1",
        )
    assert response.status_code == 200
    log = ShareAccessLog.objects.filter(share_package=pkg, action="resolved").first()
    assert log is not None
    assert log.client_ip == "203.0.113.1"


@pytest.mark.django_db
def test_resolve_uses_remote_addr_if_not_trusted_proxy():
    user = User.objects.create_user(email="iptest2@example.com", password="pw123")
    token, pkg = create_share(user, ["full_summary"])
    client = APIClient()
    with override_settings(TRUSTED_PROXIES=["10.0.0.1"]):
        response = client.post(
            "/api/shares/resolve",
            {"token": token},
            HTTP_X_FORWARDED_FOR="203.0.113.1",
            REMOTE_ADDR="127.0.0.1",
        )
    assert response.status_code == 200
    log = ShareAccessLog.objects.filter(share_package=pkg, action="resolved").first()
    assert log.client_ip == "127.0.0.1"
