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
