"""Shared client-IP helper for proxy-aware IP extraction."""
from django.conf import settings


def get_client_ip(request) -> str:
    """Extract the real client IP, respecting TRUSTED_PROXIES.

    If REMOTE_ADDR is a trusted proxy, read the RIGHTMOST X-Forwarded-For
    entry — the real client IP appended by the single trusted proxy (Caddy's
    default is to append, not overwrite). The leftmost entries are attacker-
    controllable, so taking [0] would let a client spoof its lockout/audit IP.
    This matches DRF's get_ident semantics with NUM_PROXIES=1. Otherwise fall
    back to REMOTE_ADDR (untrusted source — XFF is ignored entirely).
    """
    remote_addr = request.META.get("REMOTE_ADDR", "0.0.0.0")
    trusted_proxies = getattr(settings, "TRUSTED_PROXIES", [])
    if remote_addr in trusted_proxies:
        xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if xff:
            return xff.split(",")[-1].strip()
    return remote_addr
