from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.db import models

from apps.common.models import BaseModel
from apps.jobs.error_sanitizer import validate_timeline_event_data


class TimelineEvent(BaseModel):
    class DatePrecision(models.TextChoices):
        DAY = "day"
        MONTH = "month"
        YEAR = "year"

    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="timeline_events"
    )
    document = models.ForeignKey(
        "documents.Document",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="timeline_events",
    )
    occurred_at = models.DateField(null=True, blank=True)
    date_precision = models.CharField(
        max_length=10, choices=DatePrecision.choices, blank=True, default=""
    )
    title = models.CharField(max_length=512)
    event_type = models.CharField(max_length=128, blank=True, default="")
    category = models.CharField(max_length=128, blank=True, default="")
    source = models.CharField(max_length=64, blank=True, default="")
    summary = models.TextField(max_length=2000, blank=True, default="")
    tags = ArrayField(models.CharField(max_length=128), default=list, blank=True)
    data = models.JSONField(default=dict, blank=True)
    included_in_previsit = models.BooleanField(default=False)

    class Meta:
        db_table = "timeline_events"
        ordering = ["-occurred_at"]
        indexes = [
            models.Index(fields=["user", "source"]),
            models.Index(fields=["user", "included_in_previsit"]),
        ]

    def clean(self):
        """Validate data dict to prevent PHI storage in unstructured JSON."""
        try:
            validate_timeline_event_data(self.data)
        except ValueError as exc:
            raise ValidationError({"data": str(exc)})

    def __str__(self) -> str:
        return self.title
