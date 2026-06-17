from celery import shared_task

from . import pipeline


@shared_task(name="apps.jobs.tasks.process_documents_task")
def process_documents_task(job_id: str) -> None:
    pipeline.run_job(job_id)


@shared_task(
    bind=True,
    name="apps.jobs.tasks.profile_evaluation_task",
    autoretry_for=(Exception,),
    max_retries=2,
    retry_backoff=True,
    retry_backoff_max=60,
)
def profile_evaluation_task(self, job_id: str) -> None:
    # Retry transient failures (e.g. OpenAI timeouts) so a review-triggered re-eval
    # can't silently leave the derived health profile stale.
    pipeline.run_job(job_id)


@shared_task(name="apps.jobs.tasks.recover_stale_jobs_task")
def recover_stale_jobs_task() -> int:
    return pipeline.recover_stale_jobs()
