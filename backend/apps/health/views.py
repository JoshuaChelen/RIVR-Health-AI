from django.shortcuts import get_object_or_404
from rest_framework.generics import RetrieveAPIView
from rest_framework.permissions import IsAuthenticated

from apps.common.viewsets import ReadOnlyOwnedViewSet

from .models import HealthEvaluation, HealthProfile
from .serializers import HealthEvaluationSerializer, HealthProfileSerializer


class MyHealthProfileView(RetrieveAPIView):
    """The current user's latest health profile (written by the worker)."""

    serializer_class = HealthProfileSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self) -> HealthProfile:
        return get_object_or_404(HealthProfile, user=self.request.user)


class HealthEvaluationViewSet(ReadOnlyOwnedViewSet):
    queryset = HealthEvaluation.objects.all()
    serializer_class = HealthEvaluationSerializer
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]
