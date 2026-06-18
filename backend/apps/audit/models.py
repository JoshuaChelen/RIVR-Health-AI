from django.core.exceptions import PermissionDenied
from django.db import models

from apps.common.models import AppendOnlyManager, BaseModel


class AuditLog(BaseModel):
    """Append-only audit record. Cannot be updated or deleted."""

    class Action(models.TextChoices):
        CREATE = "create"
        UPDATE = "update"
        DELETE = "delete"
        ACCESS = "access"

    # FK is nullable so records survive user deletion
    user = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
        db_constraint=False,
    )
    user_email_snapshot = models.CharField(max_length=254, blank=True, default="")
    resource_type = models.CharField(max_length=64)
    resource_id = models.CharField(max_length=64, blank=True, default="")
    action = models.CharField(max_length=16, choices=Action.choices)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True, default="")
    status_code = models.SmallIntegerField(null=True, blank=True)

    objects = AppendOnlyManager()

    class Meta:
        db_table = "audit_logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["resource_type", "resource_id"]),
            models.Index(fields=["user"]),
        ]

    def save(self, *args, **kwargs):
        # Reject updates: an unsaved instance has _state.adding == True.
        if not self._state.adding:
            raise PermissionDenied("AuditLog entries are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionDenied("AuditLog entries cannot be deleted.")
