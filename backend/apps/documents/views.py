from django.db import transaction
from django.utils import timezone as djtz
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.common import storage
from apps.common.viewsets import OwnedModelViewSet

from .filters import DocumentFilter
from .models import Document
from .serializers import DocumentSerializer

PROCESS_TASK = "apps.jobs.tasks.process_documents_task"


class DocumentViewSet(OwnedModelViewSet):
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
    filterset_class = DocumentFilter
    ordering_fields = ["created_at", "processed_at"]
    ordering = ["-created_at"]

    def perform_destroy(self, instance: Document) -> None:
        # Detach contributions first (idempotent) so deleting a processed doc
        # doesn't orphan AI items, then remove BOTH stored objects.
        if instance.source_type != Document.SourceType.MANUAL_INPUT and instance.summary_path:
            from .provenance import detach_document
            detach_document(self.request.user, instance)
            storage.delete(instance.summary_path)
        storage.delete(instance.pdf_path)
        super().perform_destroy(instance)

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def upload(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"detail": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)
        source_type = request.data.get("source_type", Document.SourceType.FILE)
        kind = storage.document_kind(upload.content_type, source_type)
        key = storage.document_key(request.user.id, upload.name, kind)
        saved = storage.save(key, upload)
        doc = Document.objects.create(
            user=request.user,
            title=request.data.get("title", "") or upload.name,
            source_type=source_type,
            status=Document.Status.UPLOADED,
            pdf_path=saved,
            mime_type=upload.content_type or "",
            size_bytes=upload.size,
            sha256=storage.sha256_of(upload),
        )
        return Response(DocumentSerializer(doc).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def file(self, request, pk=None):
        doc = self.get_object()
        return Response({"url": storage.signed_url(doc.pdf_path)})

    @action(detail=True, methods=["get"])
    def analysis(self, request, pk=None):
        doc = self.get_object()
        if (doc.source_type == Document.SourceType.MANUAL_INPUT
                or doc.status != Document.Status.PROCESSED or not doc.summary_path):
            return Response({"detail": "No analysis available."}, status=status.HTTP_404_NOT_FOUND)
        from .provenance import build_analysis
        return Response(build_analysis(request.user, doc))

    @action(detail=True, methods=["post"])
    def detach(self, request, pk=None):
        doc = self.get_object()
        if doc.source_type == Document.SourceType.MANUAL_INPUT:
            return Response({"detail": "Manual records have no detachable results."},
                            status=status.HTTP_400_BAD_REQUEST)
        from .provenance import detach_document
        return Response(detach_document(request.user, doc))

    @action(detail=True, methods=["post"])
    def reprocess(self, request, pk=None):
        doc = self.get_object()
        if doc.source_type == Document.SourceType.MANUAL_INPUT:
            return Response({"detail": "Manual records cannot be reprocessed."},
                            status=status.HTTP_400_BAD_REQUEST)
        from apps.jobs.services import enqueue_processing
        from config import celery_app
        Document.objects.filter(id=doc.id).update(detached_at=None)
        job, reused = enqueue_processing(request.user, [doc.id])
        if job is None:
            return Response({"detail": "Nothing to process."}, status=status.HTTP_400_BAD_REQUEST)
        if not reused:
            transaction.on_commit(
                lambda: celery_app.send_task(PROCESS_TASK, args=[str(job.id)]))
        return Response({"jobId": str(job.id), "reused": reused},
                        status=status.HTTP_202_ACCEPTED)
