"""Views for GDPR/CCPA data export and account deletion with cooldown."""
import uuid
from datetime import timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.common.permissions import IsEmailVerified

from .models import AccountDeletionRequest, DataExportJob


class DataExportRequestView(APIView):
    """POST: request an async export of all user data.

    Rate-limited to 1 request per 24h per user (checked via DB).
    Returns 202 + export job ID immediately; the Celery task populates
    the signed URL asynchronously.
    """

    permission_classes = [IsAuthenticated, IsEmailVerified]

    def post(self, request):
        user = request.user
        since = timezone.now() - timedelta(days=1)
        if DataExportJob.objects.filter(user=user, requested_at__gte=since).exists():
            return Response(
                {"error": "Only one export request per 24 hours is allowed."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        job = DataExportJob.objects.create(user=user)

        # Queue the Celery task (runs inline in tests via CELERY_TASK_ALWAYS_EAGER)
        from .export_tasks import generate_data_export_task
        generate_data_export_task.delay(str(job.id))

        audit_ctx = getattr(request, "audit_context", {})
        AuditLog.objects.create(
            user=user,
            user_email_snapshot=user.email,
            resource_type="user",
            resource_id=str(user.id),
            action=AuditLog.Action.ACCESS,
            ip_address=audit_ctx.get("ip_address"),
            user_agent=audit_ctx.get("user_agent", ""),
            status_code=202,
        )

        # Re-fetch to get updated status from eager task
        job.refresh_from_db()
        return Response(
            {
                "export_id": str(job.id),
                "status": job.status,
                "export_url": job.export_url or None,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class DataExportStatusView(APIView):
    """GET: check status of a data export job."""

    permission_classes = [IsAuthenticated, IsEmailVerified]

    def get(self, request, export_id):
        user = request.user
        try:
            job = DataExportJob.objects.get(id=export_id, user=user)
        except (DataExportJob.DoesNotExist, ValueError):
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        return Response({
            "export_id": str(job.id),
            "status": job.status,
            "export_url": job.export_url or None,
            "url_expires_at": job.url_expires_at,
            "completed_at": job.completed_at,
            "error": job.error_message or None,
        })


class AccountDeletionRequestView(APIView):
    """POST: initiate an account deletion request.

    Creates an AccountDeletionRequest with a 7-day confirmation cooldown.
    Actual deletion happens in AccountDeletionConfirmView (calls User.soft_delete).
    Rate-limited to 1 request per 24h.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        since = timezone.now() - timedelta(days=1)
        if AccountDeletionRequest.objects.filter(user=user, requested_at__gte=since).exists():
            return Response(
                {"error": "Only one deletion request per 24 hours is allowed."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        can_confirm_at = timezone.now() + timedelta(days=7)
        token = uuid.uuid4().hex

        # get_or_create in case a prior incomplete request exists
        deletion_req, created = AccountDeletionRequest.objects.get_or_create(
            user=user,
            defaults={
                "can_confirm_at": can_confirm_at,
                "confirmation_token": token,
            },
        )
        if not created:
            # Reset the cooldown window
            deletion_req.can_confirm_at = can_confirm_at
            deletion_req.confirmation_token = token
            deletion_req.confirmed_at = None
            deletion_req.save(update_fields=["can_confirm_at", "confirmation_token", "confirmed_at"])

        audit_ctx = getattr(request, "audit_context", {})
        AuditLog.objects.create(
            user=user,
            user_email_snapshot=user.email,
            resource_type="user",
            resource_id=str(user.id),
            action=AuditLog.Action.DELETE,
            ip_address=audit_ctx.get("ip_address"),
            user_agent=audit_ctx.get("user_agent", ""),
            status_code=202,
        )

        return Response(
            {
                "message": "Deletion request created. Confirm after 7 days.",
                "can_confirm_at": deletion_req.can_confirm_at,
                "confirmation_token": token,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class AccountDeletionConfirmView(APIView):
    """POST: confirm account deletion after the 7-day cooldown.

    Calls User.soft_delete() — the same path as the existing DeleteAccountView.
    Also cleans up storage and soft-deletes documents, mirroring DeleteAccountView.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        token = request.data.get("confirmation_token", "")

        try:
            deletion_req = AccountDeletionRequest.objects.get(user=user)
        except AccountDeletionRequest.DoesNotExist:
            return Response(
                {"error": "No pending deletion request. POST to /delete/request/ first."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if deletion_req.confirmed_at is not None:
            return Response(
                {"error": "Deletion already confirmed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if timezone.now() < deletion_req.can_confirm_at:
            return Response(
                {
                    "error": "Cooldown period not elapsed.",
                    "can_confirm_at": deletion_req.can_confirm_at,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if token != deletion_req.confirmation_token:
            return Response(
                {"error": "Invalid confirmation token."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        deletion_req.confirmed_at = timezone.now()
        deletion_req.save(update_fields=["confirmed_at"])

        # Audit the actual execution (the request was logged separately at
        # request time; this records the irreversible soft-delete itself).
        audit_ctx = getattr(request, "audit_context", {})
        AuditLog.objects.create(
            user=user,
            user_email_snapshot=user.email,
            resource_type="user",
            resource_id=str(user.id),
            action=AuditLog.Action.DELETE,
            ip_address=audit_ctx.get("ip_address"),
            user_agent=audit_ctx.get("user_agent", ""),
            status_code=200,
        )

        # Reuse same cleanup logic as DeleteAccountView
        from apps.common import storage as obj_storage
        from apps.documents.models import Document

        obj_storage.delete_prefix(f"documents/{user.id}")
        obj_storage.delete_prefix(f"avatars/{user.id}")
        for doc in Document.all_objects.filter(user=user, deleted_at__isnull=True):
            doc.soft_delete("account_deleted")
        user.soft_delete("user_request")

        return Response({"message": "Account deletion confirmed."})
