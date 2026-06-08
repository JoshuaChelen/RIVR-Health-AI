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
