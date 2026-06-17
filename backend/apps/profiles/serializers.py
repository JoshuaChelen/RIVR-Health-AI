from rest_framework import serializers

from .models import UserProfile


class UserProfileSerializer(serializers.ModelSerializer):
    ai_review = serializers.SerializerMethodField()

    def get_ai_review(self, obj) -> dict:
        from apps.jobs.profile_logic import is_ai_backfilled
        total = unreviewed = 0
        for f in ("allergies", "medications", "medical_history", "surgical_history"):
            for it in (getattr(obj, f) or []):
                if isinstance(it, dict) and is_ai_backfilled(it.get("id")):
                    total += 1
                    if not it.get("review_status"):
                        unreviewed += 1
        return {"total": total, "unreviewed": unreviewed}

    class Meta:
        model = UserProfile
        exclude = ["user"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def to_internal_value(self, data):
        # Clients send null to clear an optional text field, but those map to
        # CharFields that are blank=True / null=False — DRF would reject null with
        # "This field may not be null." Coerce null -> "" for those fields.
        if isinstance(data, dict):
            data = {
                name: (
                    ""
                    if value is None
                    and isinstance(self.fields.get(name), serializers.CharField)
                    and not self.fields[name].allow_null
                    else value
                )
                for name, value in data.items()
            }
        return super().to_internal_value(data)
