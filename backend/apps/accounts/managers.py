from django.contrib.auth.base_user import BaseUserManager
from django.db import models


class _UserManagerMixin:
    """Shared create_user / create_superuser logic."""

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("Users must have an email address.")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        return self._create_user(email, password, **extra_fields)


class UserManager(_UserManagerMixin, BaseUserManager):
    """Default manager: hides soft-deleted users."""

    use_in_migrations = True

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)


class AllUsersManager(_UserManagerMixin, BaseUserManager):
    """Returns all users including soft-deleted ones."""

    def get_queryset(self):
        return super().get_queryset()
