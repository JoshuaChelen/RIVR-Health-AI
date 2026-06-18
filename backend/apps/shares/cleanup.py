"""Scheduled cleanup of expired share artifacts from object storage."""
import logging
from datetime import timedelta

from django.utils import timezone

from apps.common import storage

from .models import SharePackage

logger = logging.getLogger(__name__)


def cleanup_expired_shares(grace_period_hours: int = 1) -> int:
    """Delete PDF artifacts for expired share packages.

    Only processes packages that have been expired for at least
    grace_period_hours, giving clients a window to finish in-flight requests.

    Returns:
        Number of packages whose artifacts were deleted.
    """
    cutoff = timezone.now() - timedelta(hours=grace_period_hours)
    expired = SharePackage.objects.filter(
        expires_at__lt=cutoff,
        artifacts_deleted_at__isnull=True,
    )
    cleaned = 0
    for pkg in expired:
        try:
            for pdf_path in (pkg.payload_json or {}).get("pdfs", {}).values():
                if pdf_path:
                    storage.delete(pdf_path)
            pkg.artifacts_deleted_at = timezone.now()
            pkg.save(update_fields=["artifacts_deleted_at"])
            cleaned += 1
        except Exception:
            logger.exception("cleanup_expired_shares: failed on package %s", pkg.id)
    logger.info("cleanup_expired_shares: cleaned %d packages", cleaned)
    return cleaned
