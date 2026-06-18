from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from .permissions import IsEmailVerified, IsOwner


class OwnedModelViewSet(viewsets.ModelViewSet):
    """A viewset whose rows are always scoped to the requesting user.

    The queryset is filtered to the owner, so other users' rows are invisible
    (404, never a 403 existence leak), and create automatically stamps the owner.
    """

    owner_field = "user"
    permission_classes = [IsAuthenticated, IsOwner, IsEmailVerified]

    def get_queryset(self):
        return super().get_queryset().filter(**{self.owner_field: self.request.user})

    def perform_create(self, serializer):
        serializer.save(**{self.owner_field: self.request.user})


class ReadOnlyOwnedViewSet(OwnedModelViewSet):
    http_method_names = ["get", "head", "options"]
