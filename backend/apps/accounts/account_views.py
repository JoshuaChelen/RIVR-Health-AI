from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common import storage


class DeleteAccountView(APIView):
    """Permanently delete the current user, their data, and their files."""

    permission_classes = [IsAuthenticated]

    def delete(self, request):
        user = request.user
        # Best-effort storage cleanup; DB cascades remove all owned rows.
        storage.delete_prefix(f"documents/{user.id}")
        storage.delete_prefix(f"avatars/{user.id}")
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
