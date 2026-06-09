from apps.common.viewsets import OwnedModelViewSet

from .filters import TimelineEventFilter
from .models import TimelineEvent
from .serializers import TimelineEventSerializer


class TimelineEventViewSet(OwnedModelViewSet):
    queryset = TimelineEvent.objects.select_related("document").all()
    serializer_class = TimelineEventSerializer
    filterset_class = TimelineEventFilter
    ordering_fields = ["occurred_at", "created_at"]
    ordering = ["-occurred_at"]

    def get_serializer(self, *args, **kwargs):
        # Allow bulk creation (the client inserts many Apple Health events at once).
        if isinstance(kwargs.get("data"), list):
            kwargs["many"] = True
        return super().get_serializer(*args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
