from rest_framework import serializers

from .models import AiJob


class AiJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = AiJob
        exclude = ["user"]
        read_only_fields = [f.name for f in AiJob._meta.fields if f.name != "id"]
