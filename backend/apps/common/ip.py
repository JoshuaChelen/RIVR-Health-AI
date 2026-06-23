"""Shared client-IP helper for proxy-aware IP extraction."""
import ipaddress

from django.conf import settings


def _is_trusted_proxy(remote_addr: str, trusted) -> bool:
    """True if remote_addr matches a TRUSTED_PROXIES entry (exact IP or CIDR).

    CIDR support lets us trust the Docker network Caddy runs on without pinning
    its (dynamic) container IP. Safe here because web:8000 is internal-only — the
    sole peer that can reach it is Caddy on the private compose network.
    """
    try:
        addr = ipaddress.ip_address(remote_addr)
    except ValueError:
        return False
    for entry in trusted:
        entry = entry.strip()
        if not entry:
            continue
        try:
            if "/" in entry:
                if addr in ipaddress.ip_network(entry, strict=False):
                    return True
            elif remote_addr == entry:
                return True
        except ValueError:
            continue
    return False


def get_client_ip(request) -> str:
    """Extract the real client IP, respecting TRUSTED_PROXIES.

    If REMOTE_ADDR is a trusted proxy (exact IP or CIDR range — e.g. the Docker
    network Caddy runs on), read the RIGHTMOST X-Forwarded-For entry — the real
    client IP set by the single trusted proxy (Caddy overwrites XFF with the
    direct peer). The leftmost entries are attacker-controllable, so taking [0]
    would let a client spoof its lockout/audit IP. This matches DRF's get_ident
    semantics with NUM_PROXIES=1. Otherwise fall back to REMOTE_ADDR (untrusted
    source — XFF is ignored entirely).
    """
    remote_addr = request.META.get("REMOTE_ADDR", "0.0.0.0")
    trusted_proxies = getattr(settings, "TRUSTED_PROXIES", [])
    if _is_trusted_proxy(remote_addr, trusted_proxies):
        xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if xff:
            return xff.split(",")[-1].strip()
    return remote_addr
