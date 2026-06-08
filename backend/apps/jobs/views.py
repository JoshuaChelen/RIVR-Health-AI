from rest_framework.decorators import action
from rest_framework.response import Response

from apps.common.viewsets import ReadOnlyOwnedViewSet

from .filters import AiJobFilter
from .models import AiJob
from .serializers import AiJobSerializer


class AiJobViewSet(ReadOnlyOwnedViewSet):
    queryset = AiJob.objects.all()
    serializer_class = AiJobSerializer
    filterset_class = AiJobFilter
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]
    http_method_names = ["get", "head", "options", "post"]

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        job = self.get_object()
        if job.status in (AiJob.Status.QUEUED, AiJob.Status.RUNNING, AiJob.Status.PROCESSING):
            job.cancel_requested = True
            job.save(update_fields=["cancel_requested", "updated_at"])
        return Response(AiJobSerializer(job).data)
