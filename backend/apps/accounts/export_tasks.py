"""Async Celery task: gather and export all user data to a signed ZIP."""
import io
import json
import zipfile
from datetime import timedelta

from celery import shared_task
from django.utils import timezone


def _gather_user_data(user) -> dict:
    """Collect all user-owned data into a plain dict (ORM read, no bypass)."""
    from apps.accounts.models import ConsentRecord
    from apps.documents.models import Document
    from apps.health.models import HealthEvaluation, HealthProfile
    from apps.profiles.models import UserProfile
    from apps.timeline.models import TimelineEvent

    data: dict = {
        "exported_at": timezone.now().isoformat(),
        "user": {
            "id": str(user.id),
            "email": user.email,
            "date_joined": user.date_joined.isoformat(),
        },
    }

    # Profile — encrypted fields decrypt transparently via ORM getattr
    try:
        profile = UserProfile.objects.get(user=user)
        data["profile"] = {
            "first_name": profile.first_name or "",
            "last_name": profile.last_name or "",
            "date_of_birth": str(profile.date_of_birth) if profile.date_of_birth else None,
            "sex_or_gender": profile.sex_or_gender,
            "occupation": profile.occupation,
            "marital_status": profile.marital_status,
            "email": profile.email or "",
            "mobile_phone": profile.mobile_phone or "",
            "allergies": profile.allergies,
            "medications": profile.medications,
            "medical_history": profile.medical_history,
            "surgical_history": profile.surgical_history,
            "family_history": profile.family_history,
            "hospitalizations": profile.hospitalizations,
            "social_history": profile.social_history,
            "smoking_status": profile.smoking_status,
            "alcohol_use": profile.alcohol_use,
            "exercise_level": profile.exercise_level,
        }
    except UserProfile.DoesNotExist:
        data["profile"] = {}

    # Documents metadata (no file contents — signed URL access is separate)
    data["documents"] = [
        {
            "id": str(d.id),
            "title": d.title,
            "status": d.status,
            "source_type": d.source_type,
            "created_at": d.created_at.isoformat(),
        }
        for d in Document.objects.filter(user=user)
    ]

    # Timeline
    data["timeline"] = [
        {
            "id": str(t.id),
            "event_date": str(t.event_date) if t.event_date else None,
            "title": t.title,
            "event_type": t.event_type,
        }
        for t in TimelineEvent.objects.filter(user=user)
    ]

    # Health evaluations
    data["health_evaluations"] = [
        {
            "id": str(h.id),
            "score": h.score,
            "created_at": h.created_at.isoformat(),
        }
        for h in HealthEvaluation.objects.filter(user=user)
    ]

    # Health profile (current)
    try:
        hp = HealthProfile.objects.get(user=user)
        data["health_profile"] = {
            "score": hp.score,
            "score_label": hp.score_label,
        }
    except HealthProfile.DoesNotExist:
        data["health_profile"] = {}

    # Consents
    data["consents"] = [
        {
            "consent_type": c.consent_type,
            "version_date": c.version_date,
            "accepted_at": c.accepted_at.isoformat() if c.accepted_at else None,
            "withdrawn_at": c.withdrawn_at.isoformat() if c.withdrawn_at else None,
            "created_at": c.created_at.isoformat(),
        }
        for c in ConsentRecord.objects.filter(user=user).order_by("created_at")
    ]

    return data


@shared_task(name="apps.accounts.export_tasks.generate_data_export_task")
def generate_data_export_task(export_job_id: str) -> None:
    """Gather all user data into a JSON-in-ZIP, store to object storage,
    update DataExportJob with a short-lived (24h) signed URL."""
    from apps.accounts.models import DataExportJob

    try:
        job = DataExportJob.objects.get(id=export_job_id)
    except DataExportJob.DoesNotExist:
        return

    try:
        data = _gather_user_data(job.user)

        # Pack into a ZIP containing data.json
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("data.json", json.dumps(data, indent=2, default=str))
        buf.seek(0)

        from apps.common import storage as obj_storage
        from django.core.files.base import ContentFile

        key = f"exports/{job.user_id}/{export_job_id}.zip"
        content_file = ContentFile(buf.read(), name=f"{export_job_id}.zip")
        obj_storage.save(key, content_file)

        # Short-lived URL (1 hour) for the full-PHI ZIP — minimise exposure.
        signed = obj_storage.signed_url(key, expire=3600)
        expires_at = timezone.now() + timedelta(hours=1)

        job.status = DataExportJob.Status.COMPLETED
        job.export_url = signed or ""
        job.url_expires_at = expires_at
        job.completed_at = timezone.now()
        job.save()

    except Exception as exc:  # noqa: BLE001
        job.status = DataExportJob.Status.FAILED
        job.error_message = str(exc)[:500]
        job.save()


@shared_task(name="apps.accounts.export_tasks.cleanup_expired_exports_task")
def cleanup_expired_exports_task() -> int:
    """Delete export ZIPs whose signed URL has expired (orphaned PHI cleanup).

    Mirrors the share-artifact cleanup (Phase 4): removes the storage object and
    nulls the stored URL so the now-dead link is not served. The key is
    deterministic (exports/{user_id}/{job_id}.zip), matching how it was saved.
    """
    from apps.accounts.models import DataExportJob
    from apps.common import storage as obj_storage

    now = timezone.now()
    expired = DataExportJob.objects.filter(
        status=DataExportJob.Status.COMPLETED,
        url_expires_at__lt=now,
        export_url__gt="",
    )
    cleaned = 0
    for job in expired:
        key = f"exports/{job.user_id}/{job.id}.zip"
        try:
            obj_storage.delete(key)
        except Exception:  # noqa: BLE001 — best-effort, never block on storage
            pass
        job.export_url = ""
        job.save(update_fields=["export_url"])
        cleaned += 1
    return cleaned
