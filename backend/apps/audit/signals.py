"""Post-save signals that write AuditLog entries for PHI model mutations.

IP/user-agent are left blank here because signals fire from both request
context and background Celery tasks where no request is available.
"""
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.documents.models import Document
from apps.health.models import HealthEvaluation
from apps.profiles.models import UserProfile
from apps.timeline.models import TimelineEvent


def _log(resource_type, resource_id, user_id, action):
    from .models import AuditLog
    try:
        AuditLog.objects.create(
            user_id=user_id,
            resource_type=resource_type,
            resource_id=str(resource_id),
            action=action,
        )
    except Exception:
        pass  # audit must never break the main flow


@receiver(post_save, sender=Document)
def audit_document(sender, instance, created, **kwargs):
    _log("document", instance.id, instance.user_id, "create" if created else "update")


@receiver(post_save, sender=UserProfile)
def audit_user_profile(sender, instance, created, **kwargs):
    _log("user_profile", instance.id, instance.user_id, "create" if created else "update")


@receiver(post_save, sender=HealthEvaluation)
def audit_health_evaluation(sender, instance, created, **kwargs):
    _log("health_evaluation", instance.id, instance.user_id, "create" if created else "update")


@receiver(post_save, sender=TimelineEvent)
def audit_timeline_event(sender, instance, created, **kwargs):
    _log("timeline_event", instance.id, instance.user_id, "create" if created else "update")
