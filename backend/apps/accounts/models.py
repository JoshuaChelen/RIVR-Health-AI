import uuid

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.utils import timezone

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
