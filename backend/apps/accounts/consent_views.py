from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog

from .models import ConsentRecord


class ConsentStatusView(APIView):
    """GET: return current consent status for each consent type."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        result = []
        for ct in ConsentRecord.ConsentType.values:
            latest = (
                ConsentRecord.objects.filter(user=user, consent_type=ct)
                .order_by("-created_at")
                .first()
            )
            if latest:
                result.append(
                    {
                        "consent_type": ct,
                        "accepted": latest.accepted_at is not None,
                        "withdrawn": latest.withdrawn_at is not None,
                        "version_date": latest.version_date,
                        "last_updated": latest.created_at.isoformat(),
                    }
                )
        return Response({"consents": result})


class ConsentWithdrawView(APIView):
    """POST: withdraw consent (creates new record, never mutates)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        consent_type = request.data.get("consent_type")
        valid_types = ConsentRecord.ConsentType.values
        if not consent_type or consent_type not in valid_types:
            return Response(
                {"error": f"consent_type must be one of {valid_types}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        audit_ctx = getattr(request, "audit_context", {})
        ConsentRecord.objects.create(
            user=user,
            consent_type=consent_type,
            withdrawn_at=timezone.now(),
            ip_address=audit_ctx.get("ip_address", ""),
            user_agent=audit_ctx.get("user_agent", ""),
        )
        AuditLog.objects.create(
            user=user,
            user_email_snapshot=user.email,
            resource_type="user",
            resource_id=str(user.id),
            action=AuditLog.Action.UPDATE,
            ip_address=audit_ctx.get("ip_address"),
            user_agent=audit_ctx.get("user_agent", ""),
        )
        return Response({"message": f"Consent for {consent_type} withdrawn."})
