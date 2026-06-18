from rest_framework import serializers

from apps.jobs import output_validator
from apps.jobs.error_sanitizer import validate_timeline_event_data

from .models import TimelineEvent


class TimelineEventSerializer(serializers.ModelSerializer):
    document_title = serializers.CharField(source="document.title", read_only=True, default=None)
    # The model stores "" for "no precision"; clients clear a date by sending null.
    # Accept null and coerce it to "" so removing an event's date works.
    date_precision = serializers.ChoiceField(
        choices=TimelineEvent.DatePrecision.choices,
        required=False, allow_blank=True, allow_null=True, default="",
    )

    class Meta:
        model = TimelineEvent
        exclude = ["user"]
        read_only_fields = ["id", "created_at", "updated_at", "document_title"]

    def validate_date_precision(self, value):
        return value or ""

    def validate_title(self, value):
        if not value:
            return value
        # & is normal text ("Asthma & allergies"); only <, > are HTML-injection vectors.
        if any(c in value for c in ('<', '>')):
            raise serializers.ValidationError("Title cannot contain HTML characters.")
        control_chars = [chr(i) for i in range(0, 32) if i not in (9, 10, 13)]
        if any(c in value for c in control_chars):
            raise serializers.ValidationError("Title cannot contain control characters.")
        return value

    def validate_summary(self, value):
        if not value:
            return value
        if any(c in value for c in ('<', '>')):
            raise serializers.ValidationError("Summary cannot contain HTML characters.")
        control_chars = [chr(i) for i in range(0, 32) if i not in (9, 10, 13)]
        if any(c in value for c in control_chars):
            raise serializers.ValidationError("Summary cannot contain control characters.")
        return value

    def validate_tags(self, value):
        if isinstance(value, list) and len(value) > 20:
            raise serializers.ValidationError("tags cannot exceed 20 items.")
        return value

    def validate_data(self, value):
        # DRF doesn't call Model.clean() on save(), so the model-level guard never
        # runs for API writes. Enforce the same structural rules here, plus per-value
        # content validation (control chars / HTML markup) via the shared validator.
        try:
            validate_timeline_event_data(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc))
        if isinstance(value, dict):
            for key, v in value.items():
                if isinstance(v, str):
                    try:
                        output_validator.validate_text_value(f"data.{key}", v)
                    except output_validator.OutputValidationError as exc:
                        raise serializers.ValidationError(str(exc))
        return value
