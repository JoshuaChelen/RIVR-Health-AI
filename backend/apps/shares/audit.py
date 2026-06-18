"""Audit logging for share access attempts."""
import logging

from .models import ShareAccessLog

logger = logging.getLogger(__name__)


def log_share_access(
    share_package,
    action: str,
    client_ip: str,
    pin_attempt: int = None,
    views_count: int = None,
) -> None:
    """Log a share access attempt for forensic audit trail.

    Never logs plaintext tokens or PINs. Raises on DB failure so callers
    know the audit write was skipped (fail-loudly).
    """
    if share_package is None:
        # Can't log without a package reference; caller should log externally if needed
        return
    ShareAccessLog.objects.create(
        share_package=share_package,
        action=action,
        client_ip=client_ip,
        pin_attempt=pin_attempt,
        views_count=views_count,
    )
    logger.info("share_access action=%s ip=%s package=%s", action, client_ip, share_package.id)
