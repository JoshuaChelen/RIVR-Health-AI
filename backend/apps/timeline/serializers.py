from rest_framework import serializers

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
