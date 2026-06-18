from django.db import models

from apps.common.encryption import (
    EncryptedCharField,
    EncryptedDateField,
    EncryptedEmailField,
)
from apps.common.models import BaseModel, SoftDeleteModel


class UserProfile(SoftDeleteModel, BaseModel):
    """Per-user demographic + medical profile (replaces user_profiles).

    The seven medical list fields hold arrays of dict items; AI-backfilled
    items are prefixed `ai_` and tracked in ``ai_backfill_meta``.
    """

    user = models.OneToOneField(
        "accounts.User", on_delete=models.CASCADE, related_name="profile"
    )

    # Direct-identifier PII — encrypted at rest (Phase 7B). Never DB-queried.
    first_name = EncryptedCharField(max_length=255, blank=True, default="")
    last_name = EncryptedCharField(max_length=255, blank=True, default="")
    date_of_birth = EncryptedDateField(null=True, blank=True)
    sex_or_gender = models.CharField(max_length=64, blank=True, default="")
    occupation = models.CharField(max_length=255, blank=True, default="")
    marital_status = models.CharField(max_length=64, blank=True, default="")
    number_of_children = models.IntegerField(null=True, blank=True)

    # email here is the profile contact email (NOT the login identifier on
    # accounts.User); never used in a DB filter, so safe to encrypt.
    email = EncryptedEmailField(blank=True, default="")
    mobile_phone = EncryptedCharField(max_length=64, blank=True, default="")
    emergency_contact_name = EncryptedCharField(max_length=255, blank=True, default="")
    emergency_contact_phone = EncryptedCharField(max_length=64, blank=True, default="")
    emergency_contact_relationship = EncryptedCharField(max_length=128, blank=True, default="")

    smoking_status = models.CharField(max_length=64, blank=True, default="")
    alcohol_use = models.CharField(max_length=64, blank=True, default="")
    exercise_level = models.CharField(max_length=64, blank=True, default="")
    current_symptoms = models.TextField(max_length=5000, blank=True, default="")

    # JSON list fields (default [])
    allergies = models.JSONField(default=list, blank=True)
    medications = models.JSONField(default=list, blank=True)
    medical_history = models.JSONField(default=list, blank=True)
    surgical_history = models.JSONField(default=list, blank=True)
    family_history = models.JSONField(default=list, blank=True)
    hospitalizations = models.JSONField(default=list, blank=True)
    social_history = models.JSONField(default=list, blank=True)

    story_answers = models.JSONField(null=True, blank=True)
    ai_backfill_meta = models.JSONField(null=True, blank=True)

    onboarding_completed_at = models.DateTimeField(null=True, blank=True)
    health_linked_at = models.DateTimeField(null=True, blank=True)
    avatar_path = models.CharField(max_length=1024, blank=True, default="")

    class Meta:
        db_table = "user_profiles"

    def __str__(self) -> str:
        return f"Profile<{self.user_id}>"

    @classmethod
    def for_user(cls, user) -> "UserProfile":
        """Return the user's profile, creating it on first access."""
        profile, _ = cls.objects.get_or_create(user=user)
        return profile

    def clean(self):
        from django.core.exceptions import ValidationError
        errors = {}
        array_limits = {
            'allergies': 50, 'medications': 100, 'medical_history': 100,
            'surgical_history': 50, 'family_history': 50,
            'hospitalizations': 50, 'social_history': 50,
        }
        for field_name, max_count in array_limits.items():
            arr = getattr(self, field_name, []) or []
            if isinstance(arr, list) and len(arr) > max_count:
                errors[field_name] = f"Cannot exceed {max_count} items."
        if errors:
            raise ValidationError(errors)
