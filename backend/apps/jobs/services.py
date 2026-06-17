"""Job enqueue logic (mirrors the enqueue-document-processing edge function)."""
from django.db import transaction

from apps.documents.models import Document

from .models import AiJob

_ACTIVE = [AiJob.Status.QUEUED, AiJob.Status.RUNNING]


def _active(user, job_type):
    return AiJob.objects.filter(user=user, job_type=job_type, status__in=_ACTIVE)


@transaction.atomic
def enqueue_processing(user, document_ids) -> tuple[AiJob | None, bool]:
    """Queue a process_documents job for the user's *file* documents.

    Manual-input docs are excluded (they go through profile_evaluation). Returns
    (job, reused); job is None when there is nothing processable.
    """
    docs = list(
        Document.objects.filter(user=user, id__in=document_ids).exclude(
            source_type=Document.SourceType.MANUAL_INPUT
        )
    )
    doc_ids = [d.id for d in docs]
    if not doc_ids:
        return None, False
    existing = (
        _active(user, AiJob.JobType.PROCESS_DOCUMENTS)
        .filter(document_ids__overlap=doc_ids)
        .order_by("-created_at")
        .first()
    )
    if existing is not None:
        return existing, True
    job = AiJob.objects.create(
        user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=doc_ids
    )
    Document.objects.filter(id__in=doc_ids).update(status=Document.Status.PROCESSING)
    return job, False


@transaction.atomic
def enqueue_profile_evaluation(user) -> tuple[AiJob, bool]:
    """Queue a profile_evaluation job; reuse any already queued/running one."""
    existing = (
        _active(user, AiJob.JobType.PROFILE_EVALUATION).order_by("-created_at").first()
    )
    if existing is not None:
        return existing, True
    job = AiJob.objects.create(
        user=user, job_type=AiJob.JobType.PROFILE_EVALUATION, document_ids=[]
    )
    return job, False


def trigger_profile_evaluation(user) -> AiJob:
    """Enqueue a profile_evaluation AND dispatch the celery task on commit.

    Used after a review action (reject/edit/detach) so the derived HealthProfile
    (3x5 card, summary, score, facts_digest) is regenerated honoring the user's
    change. Rapid actions coalesce because enqueue_profile_evaluation reuses an
    already-active job.
    """
    from config import celery_app

    job, reused = enqueue_profile_evaluation(user)
    if not reused:
        transaction.on_commit(
            lambda: celery_app.send_task(
                "apps.jobs.tasks.profile_evaluation_task", args=[str(job.id)]
            )
        )
    return job
