from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common import storage
from apps.documents.models import Document


class DeleteAccountView(APIView):
    """Soft-delete the current user, their documents, and their files."""

    permission_classes = [IsAuthenticated]

    def delete(self, request):
        user = request.user
        # Best-effort storage cleanup.
        storage.delete_prefix(f"documents/{user.id}")
        storage.delete_prefix(f"avatars/{user.id}")
        # Soft-delete all user documents so the default manager hides them.
        for doc in Document.all_objects.filter(user=user, deleted_at__isnull=True):
            doc.soft_delete("account_deleted")
        # Soft-delete the user account.
        user.soft_delete("user_request")
        # Audit log entry.
        try:
            from apps.audit.models import AuditLog
            audit_ctx = getattr(request, "audit_context", {})
            AuditLog.objects.create(
                user_id=None,
                user_email_snapshot=user.email,
                resource_type="user",
                resource_id=str(user.id),
                action=AuditLog.Action.DELETE,
                ip_address=audit_ctx.get("ip_address"),
                user_agent=audit_ctx.get("user_agent", ""),
            )
        except Exception:
            pass
        return Response(status=status.HTTP_204_NO_CONTENT)
