from django.db import models
from django.db.models import Q, CheckConstraint

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
    pin_locked_until = models.DateTimeField(
        null=True, blank=True,
        help_text="Timestamp when PIN lockout expires; None if not locked",
    )
    payload_json = models.JSONField(default=dict, blank=True)
    artifacts_deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "share_packages"
        ordering = ["-created_at"]
        constraints = [
            CheckConstraint(
                condition=Q(pin_attempts__lte=30),
                name="pin_attempts_max_30",
            ),
        ]

    def __str__(self) -> str:
        return f"SharePackage<{self.id}> {self.file_type}"


class ShareAccessLog(models.Model):
    """Immutable audit log of share token access attempts.

    Never stored: the plaintext token or PIN.
    """

    ACTION_RESOLVED = "resolved"
    ACTION_TOKEN_INVALID = "token_invalid"
    ACTION_EXPIRED = "expired"
    ACTION_PIN_MISMATCH = "pin_mismatch"
    ACTION_PIN_LOCKED = "pin_locked"
    ACTION_VIEW_LIMIT_EXCEEDED = "view_limit_exceeded"

    share_package = models.ForeignKey(
        SharePackage, on_delete=models.CASCADE, related_name="access_logs"
    )
    action = models.CharField(
        max_length=32,
        choices=[
            (ACTION_RESOLVED, "Successfully resolved"),
            (ACTION_TOKEN_INVALID, "Invalid or revoked token"),
            (ACTION_EXPIRED, "Share expired"),
            (ACTION_PIN_MISMATCH, "Wrong PIN"),
            (ACTION_PIN_LOCKED, "PIN lockout active"),
            (ACTION_VIEW_LIMIT_EXCEEDED, "Max views reached"),
        ],
    )
    client_ip = models.CharField(max_length=45, db_index=True)
    pin_attempt = models.IntegerField(null=True, blank=True)
    views_count = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "share_access_logs"
        indexes = [
            models.Index(fields=["share_package", "action", "created_at"]),
            models.Index(fields=["client_ip", "created_at"]),
        ]

    def save(self, *args, **kwargs):
        # Append-only: block updates to existing rows
        if self.pk is not None:
            raise ValueError("ShareAccessLog entries are immutable")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("ShareAccessLog entries cannot be deleted")

    def __str__(self) -> str:
        return f"ShareAccessLog<{self.pk}> {self.action} from {self.client_ip}"
