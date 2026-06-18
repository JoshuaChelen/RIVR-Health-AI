"""Shared client-IP helper for proxy-aware IP extraction."""
from django.conf import settings


def get_client_ip(request) -> str:
    """Extract the real client IP, respecting TRUSTED_PROXIES.

    If REMOTE_ADDR is a trusted proxy, read the leftmost (client) IP from
    X-Forwarded-For (set by the proxy). Otherwise fall back to REMOTE_ADDR.
    This prevents arbitrary spoofing from untrusted sources while still
    working correctly behind Caddy or another single-hop proxy.
    """
    remote_addr = request.META.get("REMOTE_ADDR", "0.0.0.0")
    trusted_proxies = getattr(settings, "TRUSTED_PROXIES", [])
    if remote_addr in trusted_proxies:
        xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if xff:
            return xff.split(",")[0].strip()
    return remote_addr
