from django.db import models

from apps.common.models import BaseModel, TimeStampedModel


class HealthProfile(TimeStampedModel):
    """Latest health score + summary (replaces health_profiles).

    The user is the primary key (one current profile per user); the worker
    upserts this row after each evaluation.
    """

    user = models.OneToOneField(
        "accounts.User",
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="health_profile",
    )
    score = models.IntegerField()
    score_label = models.CharField(max_length=64)
    summary_json = models.JSONField(default=dict, blank=True)
    card_json = models.JSONField(default=dict, blank=True)
    sources = models.JSONField(default=dict, blank=True)
    version = models.CharField(max_length=32, default="profile_v2")

    class Meta:
        db_table = "health_profiles"

    def __str__(self) -> str:
        return f"HealthProfile<{self.user_id}> {self.score}"


class HealthEvaluation(BaseModel):
    """Append-only log of every evaluation result (replaces health_evaluations)."""

    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="health_evaluations"
    )
    score = models.IntegerField()
    result = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "health_evaluations"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"HealthEvaluation<{self.id}> {self.score}"
