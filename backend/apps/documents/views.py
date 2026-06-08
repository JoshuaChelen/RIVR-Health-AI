from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.common import storage
from apps.common.viewsets import OwnedModelViewSet

from .filters import DocumentFilter
from .models import Document
from .serializers import DocumentSerializer


class DocumentViewSet(OwnedModelViewSet):
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
    filterset_class = DocumentFilter
    ordering_fields = ["created_at", "processed_at"]
    ordering = ["-created_at"]

    def perform_destroy(self, instance: Document) -> None:
        # Remove the stored file; DB cascades handle timeline (SET_NULL) + share items.
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
