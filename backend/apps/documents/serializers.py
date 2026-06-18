from rest_framework import serializers

from .models import Document


class DocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        # sha256: internal content fingerprint — confirmed no client usage.
        # processing_error and content_json are KEPT: the mobile client reads the
        # failed-doc UI from processing_error and writes content_json on manual-profile
        # upsert. processing_error content is sanitized in Document.save().
        exclude = ["user", "sha256"]
        read_only_fields = ["id", "created_at", "updated_at", "processed_at", "detached_at"]
