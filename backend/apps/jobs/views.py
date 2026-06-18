from django.db import transaction
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from apps.common.permissions import IsEmailVerified
from rest_framework.response import Response
from rest_framework.views import APIView

from config import celery_app

from apps.common.viewsets import ReadOnlyOwnedViewSet

from .filters import AiJobFilter
from .models import AiJob
from .serializers import AiJobSerializer
from .services import enqueue_processing, enqueue_profile_evaluation

PROCESS_TASK = "apps.jobs.tasks.process_documents_task"
PROFILE_TASK = "apps.jobs.tasks.profile_evaluation_task"


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
        if job.status in (AiJob.Status.QUEUED, AiJob.Status.RUNNING):
            job.cancel_requested = True
            job.save(update_fields=["cancel_requested", "updated_at"])
        return Response(AiJobSerializer(job).data)


class EnqueueView(APIView):
    permission_classes = [IsAuthenticated, IsEmailVerified]

    def post(self, request):
        job_type = request.data.get("jobType") or request.data.get("job_type")
        if job_type == AiJob.JobType.PROFILE_EVALUATION:
            job, reused = enqueue_profile_evaluation(request.user)
            task = PROFILE_TASK
        else:
            ids = (
                request.data.get("documentIds")
                or request.data.get("document_ids")
                or ([request.data["documentId"]] if request.data.get("documentId") else [])
            )
            job, reused = enqueue_processing(request.user, ids)
            task = PROCESS_TASK
        if job is None:
            return Response(
                {"detail": "No processable documents."}, status=status.HTTP_400_BAD_REQUEST
            )
        if not reused:
            transaction.on_commit(lambda: celery_app.send_task(task, args=[str(job.id)]))
        return Response({"jobId": str(job.id), "reused": reused}, status=status.HTTP_202_ACCEPTED)
