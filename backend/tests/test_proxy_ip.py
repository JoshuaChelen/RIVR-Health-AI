"""Phase X tests: proxy-aware IP consolidation and DRF NUM_PROXIES throttle key."""
import pytest
from django.test import override_settings


# --- Unit tests: shared get_client_ip ---

class FakeRequest:
    def __init__(self, remote_addr, xff=None):
        self.META = {"REMOTE_ADDR": remote_addr}
        if xff is not None:
            self.META["HTTP_X_FORWARDED_FOR"] = xff


def test_get_client_ip_trusted_proxy_reads_rightmost_xff():
    """When REMOTE_ADDR is a trusted proxy, return the RIGHTMOST XFF entry.

    Caddy appends the real client IP as the last entry, so the rightmost is
    the trustworthy one. Here "9.9.9.9" is a client-supplied (spoofable)
    leftmost entry; the real appended client is "203.0.113.5".
    """
    from apps.common.ip import get_client_ip
    req = FakeRequest("10.0.0.1", xff="9.9.9.9, 203.0.113.5")
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
# DRF's BaseThrottle.get_ident with NUM_PROXIES=N picks addrs[-N] from the XFF
# list — the rightmost N entries are the trusted proxy hops. With a single
# Caddy hop (NUM_PROXIES=1) it reads addrs[-1], the real client IP that Caddy
# appended. Any leftmost entries are attacker-supplied and ignored.

def test_throttle_ident_uses_xff_client_ip_with_num_proxies():
    """With NUM_PROXIES=1, DRF get_ident reads the rightmost XFF entry.

    Caddy appends the real client IP before forwarding, so Django sees
    HTTP_X_FORWARDED_FOR=<...client> and REMOTE_ADDR=<caddy_ip>.
    DRF picks addrs[-1] = the real client.
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


# --- Spoof resistance: leftmost (attacker) XFF entry must be ignored ---

def test_spoofed_leftmost_xff_ignored_by_both_helper_and_throttle():
    """An attacker-supplied leftmost XFF entry must NOT become the client IP.

    The attacker sends `X-Forwarded-For: 1.1.1.1`; the single trusted proxy
    (Caddy) appends the real client → `1.1.1.1, 203.0.113.42`. Both the shared
    get_client_ip (TRUSTED_PROXIES set) and DRF's get_ident (NUM_PROXIES=1)
    must return the rightmost real client `203.0.113.42`, never `1.1.1.1`.
    Otherwise lockout/audit IPs are spoofable and disagree with the throttle.
    """
    from apps.common.ip import get_client_ip
    from rest_framework.throttling import BaseThrottle
    from rest_framework.settings import api_settings

    spoofed_xff = "1.1.1.1, 203.0.113.42"
    req = FakeRequest("10.0.0.1", xff=spoofed_xff)

    with override_settings(TRUSTED_PROXIES=["10.0.0.1"]):
        assert get_client_ip(req) == "203.0.113.42"

    original = api_settings.NUM_PROXIES
    api_settings.NUM_PROXIES = 1
    try:
        ident = BaseThrottle().get_ident(req)
        assert ident == "203.0.113.42", f"Throttle used spoofed IP: {ident!r}"
    finally:
        api_settings.NUM_PROXIES = original
