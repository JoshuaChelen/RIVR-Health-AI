import uuid

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.core.exceptions import PermissionDenied
from django.db import models
from django.utils import timezone

from apps.common.models import AppendOnlyManager

from .managers import AllUsersManager, UserManager


class User(AbstractBaseUser, PermissionsMixin):
    """Custom user keyed by email and a UUID primary key (replaces auth.users)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    password_reset_token_used_at = models.DateTimeField(null=True, blank=True)
    date_joined = models.DateTimeField(default=timezone.now)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deletion_reason = models.CharField(max_length=255, blank=True, default="")

    objects = UserManager()
    all_objects = AllUsersManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        db_table = "users"
        ordering = ["-date_joined"]

    def __str__(self) -> str:
        return self.email

    @property
    def is_email_verified(self) -> bool:
        return self.email_verified_at is not None

    def soft_delete(self, reason: str = "") -> None:
        self.deleted_at = timezone.now()
        self.deletion_reason = reason
        self.save(update_fields=["deleted_at", "deletion_reason"])


class ConsentRecord(models.Model):
    """Immutable consent snapshot for GDPR/CCPA.

    Never mutate — withdrawal = new row with withdrawn_at set.
    """

    class ConsentType(models.TextChoices):
        PRIVACY_POLICY = "privacy_policy", "Privacy Policy"
        TERMS_OF_SERVICE = "terms_of_service", "Terms of Service"
        MARKETING = "marketing", "Marketing Communications"
        DATA_PROCESSING_OPENAI = "data_processing_openai", "OpenAI Data Processing"

    user = models.ForeignKey(
        "accounts.User",
        on_delete=models.CASCADE,
        related_name="consent_records",
    )
    consent_type = models.CharField(max_length=32, choices=ConsentType.choices)
    version_date = models.CharField(
        max_length=10,
        default="2024-01-01",
        help_text="YYYY-MM-DD policy version",
    )
    accepted_at = models.DateTimeField(null=True, blank=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    ip_address = models.CharField(max_length=45, blank=True, default="")
    user_agent = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    objects = AppendOnlyManager()

    class Meta:
        db_table = "consent_records"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "consent_type", "-created_at"]),
        ]

    def save(self, *args, **kwargs):
        # Append-only: existing records are immutable. Withdrawal creates a NEW
        # row, so create() must still work (a fresh instance is _state.adding).
        if not self._state.adding:
            raise PermissionDenied("ConsentRecord entries are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionDenied("ConsentRecord entries cannot be deleted.")

    def __str__(self) -> str:
        status = "accepted" if self.accepted_at else "withdrawn"
        return f"{self.user_id} {self.consent_type} {status}"


class DataExportJob(models.Model):
    """Tracks async user-data export requests + signed-URL result."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        "accounts.User",
        on_delete=models.CASCADE,
        related_name="export_jobs",
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )
    export_url = models.URLField(blank=True, default="")
    url_expires_at = models.DateTimeField(null=True, blank=True)
    requested_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True, default="")

    class Meta:
        db_table = "data_export_jobs"
        ordering = ["-requested_at"]
        indexes = [
            models.Index(fields=["user", "-requested_at"]),
        ]

    def __str__(self) -> str:
        return f"Export<{self.id}> {self.status}"


class AccountDeletionRequest(models.Model):
    """Tracks a deletion request + 7-day cooldown before confirmation.

    Confirmation calls the existing User.soft_delete() flow — this model
    only adds the request/cooldown gate on top of it.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        "accounts.User",
        on_delete=models.CASCADE,
        related_name="deletion_request",
    )
    requested_at = models.DateTimeField(auto_now_add=True)
    can_confirm_at = models.DateTimeField()
    confirmation_token = models.CharField(max_length=64, default="")
    confirmed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "account_deletion_requests"

    def __str__(self) -> str:
        return f"DeletionRequest<{self.user_id}>"
