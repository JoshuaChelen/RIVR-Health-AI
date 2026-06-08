from rest_framework import serializers

from .models import TimelineEvent


class TimelineEventSerializer(serializers.ModelSerializer):
    document_title = serializers.CharField(source="document.title", read_only=True, default=None)

    class Meta:
        model = TimelineEvent
        exclude = ["user"]
        read_only_fields = ["id", "created_at", "updated_at", "document_title"]
