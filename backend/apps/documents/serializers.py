from rest_framework import serializers

from .models import Document


class DocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        # processing_error: raw exception text — never expose to clients
        # sha256: internal content fingerprint — not a client-facing field
        # content_json: raw extracted text blob — too large and contains PHI
        exclude = ["user", "processing_error", "sha256", "content_json"]
        read_only_fields = ["id", "created_at", "updated_at", "processed_at", "detached_at"]
