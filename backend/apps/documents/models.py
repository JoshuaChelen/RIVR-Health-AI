from django.db import models
from django.db.models import Q, UniqueConstraint

from apps.common.models import BaseModel


class Document(BaseModel):
    class Status(models.TextChoices):
        UPLOADED = "uploaded"
        PROCESSING = "processing"
        PROCESSED = "processed"
        FAILED = "failed"

    class SourceType(models.TextChoices):
        FILE = "file"
        PDF = "pdf"
        SCANNED_PDF = "scanned_pdf"
        VOICE_NOTE = "voice_note"
        MANUAL_INPUT = "manual_input"
        IMAGE = "image"

    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="documents"
    )
    title = models.CharField(max_length=512, blank=True, default="")
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.UPLOADED
    )
    source_type = models.CharField(
        max_length=20, choices=SourceType.choices, default=SourceType.FILE
    )
    pdf_path = models.CharField(max_length=1024, blank=True, default="")
    summary_path = models.CharField(max_length=1024, blank=True, default="")
    mime_type = models.CharField(max_length=255, blank=True, default="")
    size_bytes = models.BigIntegerField(null=True, blank=True)
    sha256 = models.CharField(max_length=64, blank=True, default="")
    processing_error = models.TextField(blank=True, default="")
    processed_at = models.DateTimeField(null=True, blank=True)
    content_json = models.JSONField(null=True, blank=True)

    class Meta:
        db_table = "documents"
        ordering = ["-created_at"]
        constraints = [
            # At most one manual-input document per user.
            UniqueConstraint(
                fields=["user"],
                condition=Q(source_type="manual_input"),
                name="uniq_manual_input_doc_per_user",
            ),
        ]

    def __str__(self) -> str:
        return self.title or f"Document<{self.id}>"
