"""Reusable abstract base models."""
import uuid

from django.core.exceptions import PermissionDenied
from django.db import models
from django.utils import timezone


class UUIDModel(models.Model):
    """Primary key is a UUID (matches the legacy gen_random_uuid() pks)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class BaseModel(UUIDModel, TimeStampedModel):
    class Meta:
        abstract = True


class SoftDeleteManager(models.Manager):
    """Default manager: returns only non-deleted rows."""

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)


class AllObjectsManager(models.Manager):
    """Returns all rows including soft-deleted ones."""

    def get_queryset(self):
        return models.QuerySet(self.model, using=self._db)


class SoftDeleteModel(models.Model):
    """Mixin that adds soft-delete behaviour.

    * ``objects`` (default) hides deleted rows — all existing queries stay intact.
    * ``all_objects`` returns everything including deleted rows.
    * ``soft_delete(reason)`` sets deleted_at + deletion_reason.
    * ``delete()`` is overridden to call soft_delete() so ORM .delete() is also soft.
    """

    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deletion_reason = models.CharField(max_length=255, blank=True, default="")

    objects = SoftDeleteManager()
    all_objects = AllObjectsManager()

    class Meta:
        abstract = True

    def soft_delete(self, reason: str = "") -> None:
        self.deleted_at = timezone.now()
        self.deletion_reason = reason
        self.save(update_fields=["deleted_at", "deletion_reason"])

    def delete(self, using=None, keep_parents=False):  # type: ignore[override]
        self.soft_delete()
        return 0, {}


class AppendOnlyQuerySet(models.QuerySet):
    """QuerySet for immutable logs: bulk delete is forbidden.

    Instance .delete() is blocked on the model; this closes the bypass where
    ``Model.objects.filter(...).delete()`` issues raw SQL that skips the instance
    override and would wipe the audit trail.
    """

    def delete(self):
        raise PermissionDenied("Append-only log entries cannot be deleted.")


class AppendOnlyManager(models.Manager):
    """Manager that returns an AppendOnlyQuerySet (create() still works)."""

    def get_queryset(self):
        return AppendOnlyQuerySet(self.model, using=self._db)
