from rest_framework import serializers

from .models import AiJob


class AiJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = AiJob
        # error: contains exception text (already generic, but keep off API for defence-in-depth)
        # result: internal job result dict — confirmed no client usage.
        # progress is KEPT: the client reads progress.currentDocId for the per-doc
        # progress bar; it holds only UUIDs/counters (no PHI).
        exclude = ["user", "error", "result"]
        read_only_fields = [f.name for f in AiJob._meta.fields if f.name != "id"]
