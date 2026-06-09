from rest_framework import serializers

from .models import HealthEvaluation, HealthProfile


class HealthProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = HealthProfile
        exclude = ["user"]


class HealthEvaluationSerializer(serializers.ModelSerializer):
    class Meta:
        model = HealthEvaluation
        exclude = ["user"]
