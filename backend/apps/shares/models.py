from django.db import models

from apps.common.models import BaseModel


class SharePackage(BaseModel):
    """A time- and view-limited public share (replaces share_packages).

    Only the SHA-256 of the share token is stored; expiry (1 min) and
    max_views (2) are enforced server-side and are not client-overridable.
    """

    class FileType(models.TextChoices):
        HEALTH_PROFILE = "health_profile"

    owner = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="share_packages"
    )
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    file_type = models.CharField(max_length=20, choices=FileType.choices)
    expires_at = models.DateTimeField()
    revoked = models.BooleanField(default=False)
    max_views = models.IntegerField(null=True, blank=True)
    views_count = models.IntegerField(default=0)
    pin_hash = models.CharField(max_length=128, blank=True, default="")
    pin_attempts = models.IntegerField(default=0)
    payload_json = models.JSONField(default=dict, blank=True)
    artifacts_deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "share_packages"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"SharePackage<{self.id}> {self.file_type}"
