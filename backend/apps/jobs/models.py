from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import PermissionDenied
from django.db import models

from apps.common.models import BaseModel, SoftDeleteModel
from pgvector.django import HnswIndex, VectorField


class AiJob(SoftDeleteModel, BaseModel):
    class JobType(models.TextChoices):
        PROCESS_DOCUMENTS = "process_documents"
        PROFILE_EVALUATION = "profile_evaluation"

    class Status(models.TextChoices):
        QUEUED = "queued"
        RUNNING = "running"
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


class Embedding(BaseModel):
    class Kind(models.TextChoices):
        DOC_CHUNK = "doc_chunk"
        FACT = "fact"
        TIMELINE = "timeline"

    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="embeddings")
    document = models.ForeignKey(
        "documents.Document", on_delete=models.CASCADE, null=True, blank=True, related_name="embeddings"
    )
    kind = models.CharField(max_length=16, choices=Kind.choices)
    ref = models.CharField(max_length=64, blank=True, default="")
    content = models.TextField()
    vector = VectorField(dimensions=768)

    class Meta:
        db_table = "embeddings"
        indexes = [
            HnswIndex(name="emb_vec_hnsw", fields=["vector"], m=16, ef_construction=64,
                      opclasses=["vector_cosine_ops"]),
            models.Index(fields=["user"]),
        ]


class BackfillAuditLog(BaseModel):
    """Append-only record of every AI/manual backfill mutation on the health profile."""

    class Source(models.TextChoices):
        AI_EXTRACTION = "ai_extraction"
        MANUAL_APPROVAL = "manual_approval"
        SYSTEM_IMPORT = "system_import"

    user = models.ForeignKey(
        "accounts.User", on_delete=models.PROTECT, related_name="backfill_audit_logs"
    )
    evaluation_id = models.CharField(max_length=64, blank=True, null=True)
    document_id = models.CharField(max_length=64, blank=True, null=True)
    field_name = models.CharField(max_length=128)
    old_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField()
    source = models.CharField(max_length=32, choices=Source.choices)
    approved_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_backfills",
    )

    class Meta:
        db_table = "backfill_audit_logs"
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not kwargs.get("force_insert") and self.pk is not None:
            if self.__class__.objects.filter(pk=self.pk).exists():
                raise PermissionDenied("BackfillAuditLog entries are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionDenied("BackfillAuditLog entries cannot be deleted.")
