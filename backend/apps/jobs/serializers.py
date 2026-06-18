from rest_framework import serializers

from .models import AiJob


class AiJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = AiJob
        # error: contains exception text (already generic, but keep off API for defence-in-depth)
        # progress: internal orchestration state, not consumed by clients
        # result: internal job result dict, not a client-facing field
        exclude = ["user", "error", "progress", "result"]
        read_only_fields = [f.name for f in AiJob._meta.fields if f.name != "id"]
