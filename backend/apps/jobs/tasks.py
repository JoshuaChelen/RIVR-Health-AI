import openai
from celery import shared_task

from . import pipeline

# Only genuinely transient failures are retried. Validation errors, bad requests,
# and code bugs are NOT retried (they won't succeed on an identical re-run) — they
# fail fast so the job surfaces the real error instead of burning retries.
_TRANSIENT_ERRORS = (
    openai.APITimeoutError,
    openai.APIConnectionError,
    openai.RateLimitError,
    openai.InternalServerError,
    pipeline.TransientError,
)


@shared_task(name="apps.jobs.tasks.process_documents_task")
def process_documents_task(job_id: str) -> None:
    pipeline.run_job(job_id)


@shared_task(
    bind=True,
    name="apps.jobs.tasks.profile_evaluation_task",
    autoretry_for=_TRANSIENT_ERRORS,
    max_retries=2,
    retry_backoff=True,
    retry_backoff_max=60,
)
def profile_evaluation_task(self, job_id: str) -> None:
    # Retry only transient failures (OpenAI timeouts/5xx/rate-limits, storage read
    # blips) so a review-triggered re-eval can't silently leave the profile stale.
    pipeline.run_job(job_id)


@shared_task(name="apps.jobs.tasks.recover_stale_jobs_task")
def recover_stale_jobs_task() -> int:
    return pipeline.recover_stale_jobs()


@shared_task(name="apps.shares.tasks.cleanup_expired_shares_task")
def cleanup_expired_shares_task() -> int:
    """Hourly task: delete orphaned PHI PDFs for expired share packages."""
    from django.conf import settings as djsettings
    from apps.shares.cleanup import cleanup_expired_shares
    grace = getattr(djsettings, "SHARE_CLEANUP_GRACE_HOURS", 1)
    return cleanup_expired_shares(grace_period_hours=grace)


@shared_task(name="apps.jobs.tasks.purge_expired_soft_deletes_task")
def purge_expired_soft_deletes_task() -> dict:
    """Daily task: hard-delete PHI rows soft-deleted more than 30 days ago."""
    from datetime import timedelta

    from django.utils import timezone

    from apps.accounts.models import User
    from apps.documents.models import Document
    from apps.health.models import HealthEvaluation, HealthProfile
    from apps.jobs.models import AiJob
    from apps.profiles.models import UserProfile
    from apps.timeline.models import TimelineEvent

    cutoff = timezone.now() - timedelta(days=30)
    counts = {}

    n, _ = Document.all_objects.filter(deleted_at__isnull=False, deleted_at__lt=cutoff).delete()
    counts["documents"] = n

    n, _ = UserProfile.all_objects.filter(deleted_at__isnull=False, deleted_at__lt=cutoff).delete()
    counts["user_profiles"] = n

    n, _ = TimelineEvent.all_objects.filter(deleted_at__isnull=False, deleted_at__lt=cutoff).delete()
    counts["timeline_events"] = n

    n, _ = HealthEvaluation.all_objects.filter(deleted_at__isnull=False, deleted_at__lt=cutoff).delete()
    counts["health_evaluations"] = n

    n, _ = HealthProfile.all_objects.filter(deleted_at__isnull=False, deleted_at__lt=cutoff).delete()
    counts["health_profiles"] = n

    n, _ = AiJob.all_objects.filter(deleted_at__isnull=False, deleted_at__lt=cutoff).delete()
    counts["ai_jobs"] = n

    # Users last: by now their PHI rows are gone, and BackfillAuditLog/AuditLog FKs
    # are SET_NULL so the user hard-delete is not blocked by ProtectedError.
    n, _ = User.all_objects.filter(deleted_at__isnull=False, deleted_at__lt=cutoff).delete()
    counts["users"] = n

    return counts
