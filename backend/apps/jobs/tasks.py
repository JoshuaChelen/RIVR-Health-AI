from celery import shared_task

from . import pipeline


@shared_task(name="apps.jobs.tasks.process_documents_task")
def process_documents_task(job_id: str) -> None:
    pipeline.run_job(job_id)


@shared_task(name="apps.jobs.tasks.profile_evaluation_task")
def profile_evaluation_task(job_id: str) -> None:
    pipeline.run_job(job_id)


@shared_task(name="apps.jobs.tasks.recover_stale_jobs_task")
def recover_stale_jobs_task() -> int:
    return pipeline.recover_stale_jobs()
