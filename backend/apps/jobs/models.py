from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.common.models import BaseModel


class AiJob(BaseModel):
    class JobType(models.TextChoices):
        PROCESS_DOCUMENTS = "process_documents"
        PROFILE_EVALUATION = "profile_evaluation"

    class Status(models.TextChoices):
        QUEUED = "queued"
        RUNNING = "running"
        PROCESSING = "processing"
        SUCCEEDED = "succeeded"
        FAILED = "failed"
        CANCELLED = "cancelled"

    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="ai_jobs"
    )
    job_type = models.CharField(max_length=32, choices=JobType.choices)
    document_ids = ArrayField(models.UUIDField(), default=list, blank=True)
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.QUEUED
    )
    priority = models.IntegerField(default=100)
    attempts = models.IntegerField(default=0)
    locked_at = models.DateTimeField(null=True, blank=True)
    locked_by = models.CharField(max_length=255, blank=True, default="")
    stage = models.CharField(max_length=128, blank=True, default="")
    heartbeat_at = models.DateTimeField(null=True, blank=True)
    progress = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True, default="")
    result = models.JSONField(null=True, blank=True)
    cancel_requested = models.BooleanField(default=False)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ai_jobs"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "status"])]

    def __str__(self) -> str:
        return f"AiJob<{self.id}> {self.job_type} {self.status}"


class AiJobEvent(models.Model):
    class Level(models.TextChoices):
        DEBUG = "debug"
        INFO = "info"
        WARN = "warn"
        ERROR = "error"

    job = models.ForeignKey(AiJob, on_delete=models.CASCADE, related_name="events")
    at = models.DateTimeField(auto_now_add=True)
    level = models.CharField(max_length=8, choices=Level.choices, default=Level.INFO)
    message = models.TextField()
    data = models.JSONField(null=True, blank=True)

    class Meta:
        db_table = "ai_job_events"
        ordering = ["at"]

    def __str__(self) -> str:
        return f"[{self.level}] {self.message[:40]}"
