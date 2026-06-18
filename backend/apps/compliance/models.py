from django.db import models
from django.utils import timezone

from apps.common.models import BaseModel


class SubprocessorBAA(BaseModel):
    """Registry of Business Associate Agreements with third-party subprocessors."""

    class Status(models.TextChoices):
        PENDING = "pending"
        SIGNED = "signed"
        EXPIRED = "expired"
        TERMINATED = "terminated"

    vendor_name = models.CharField(max_length=255, unique=True)
    service = models.CharField(max_length=512, blank=True, default="")
    baa_signed_date = models.DateField()
    baa_expires_at = models.DateField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    notes = models.TextField(blank=True, default="")

    class Meta:
        db_table = "subprocessor_baas"
        ordering = ["vendor_name"]

    def __str__(self) -> str:
        return f"{self.vendor_name} ({self.status})"

    def is_expired(self) -> bool:
        return self.baa_expires_at < timezone.now().date()

    def days_until_expiry(self) -> int:
        return (self.baa_expires_at - timezone.now().date()).days
