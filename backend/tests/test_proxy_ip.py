"""Phase X tests: proxy-aware IP consolidation and DRF NUM_PROXIES throttle key."""
import pytest
from django.test import override_settings


# --- Unit tests: shared get_client_ip ---

class FakeRequest:
    def __init__(self, remote_addr, xff=None):
        self.META = {"REMOTE_ADDR": remote_addr}
        if xff is not None:
            self.META["HTTP_X_FORWARDED_FOR"] = xff


def test_get_client_ip_trusted_proxy_reads_xff():
    """When REMOTE_ADDR is a trusted proxy, return the leftmost XFF entry."""
    from apps.common.ip import get_client_ip
    req = FakeRequest("10.0.0.1", xff="203.0.113.5, 10.0.0.1")
    with override_settings(TRUSTED_PROXIES=["10.0.0.1"]):
        assert get_client_ip(req) == "203.0.113.5"


def test_get_client_ip_untrusted_proxy_ignores_xff():
    """When REMOTE_ADDR is NOT a trusted proxy, XFF is ignored (anti-spoofing)."""
    from apps.common.ip import get_client_ip
    req = FakeRequest("8.8.8.8", xff="203.0.113.5")
    with override_settings(TRUSTED_PROXIES=["10.0.0.1"]):
        assert get_client_ip(req) == "8.8.8.8"


def test_get_client_ip_no_trusted_proxies_uses_remote_addr():
    """Empty TRUSTED_PROXIES → always use REMOTE_ADDR regardless of XFF."""
    from apps.common.ip import get_client_ip
    req = FakeRequest("1.2.3.4", xff="203.0.113.5")
    with override_settings(TRUSTED_PROXIES=[]):
        assert get_client_ip(req) == "1.2.3.4"


# --- DRF throttle key uses XFF when NUM_PROXIES > 0 ---
#
# DRF's SimpleRateThrottle.get_ident with NUM_PROXIES=N picks addrs[-N] from
# the XFF list (rightmost N entries are the proxy hops added by infrastructure).
# With a single Caddy hop the proxy appends one entry, so the client IP is at
# position addrs[-1] when XFF has exactly one entry (the real client), or at
# addrs[-1] more generally because Caddy writes a single-IP XFF header.

def test_throttle_ident_uses_xff_client_ip_with_num_proxies():
    """With NUM_PROXIES=1, DRF get_ident reads from XFF, not REMOTE_ADDR.

    Caddy sets XFF to the real client IP before forwarding, so Django sees
    HTTP_X_FORWARDED_FOR=<client_ip> and REMOTE_ADDR=<caddy_ip>.
    DRF picks addrs[-1] = the single XFF entry = real client.
    """
    from rest_framework.throttling import BaseThrottle
    from rest_framework.settings import api_settings

    # Temporarily patch NUM_PROXIES on the live api_settings object.
    original = api_settings.NUM_PROXIES
    api_settings.NUM_PROXIES = 1
    try:
        throttle = BaseThrottle()
        req = FakeRequest("10.0.0.1", xff="203.0.113.42")
        ident = throttle.get_ident(req)
        assert ident == "203.0.113.42", f"Expected XFF client IP, got {ident!r}"
    finally:
        api_settings.NUM_PROXIES = original


def test_throttle_ident_uses_remote_addr_when_num_proxies_zero():
    """With NUM_PROXIES=0 (test env default), DRF get_ident ignores XFF."""
    from rest_framework.throttling import BaseThrottle
    from rest_framework.settings import api_settings

    original = api_settings.NUM_PROXIES
    api_settings.NUM_PROXIES = 0
    try:
        throttle = BaseThrottle()
        req = FakeRequest("203.0.113.99", xff="5.5.5.5")
        ident = throttle.get_ident(req)
        assert ident == "203.0.113.99", f"Expected REMOTE_ADDR, got {ident!r}"
    finally:
        api_settings.NUM_PROXIES = original
