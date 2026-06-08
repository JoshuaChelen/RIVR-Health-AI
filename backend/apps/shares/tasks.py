from celery import shared_task

from .services import cleanup_expired_artifacts


@shared_task(name="apps.shares.tasks.cleanup_expired_share_artifacts")
def cleanup_expired_share_artifacts() -> int:
    return cleanup_expired_artifacts()
