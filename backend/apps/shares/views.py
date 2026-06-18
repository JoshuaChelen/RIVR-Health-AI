from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.permissions import IsEmailVerified

from .services import create_share, resolve_share


def get_client_ip(request) -> str:
    """Extract client IP, respecting TRUSTED_PROXIES.

    If REMOTE_ADDR is a trusted proxy, read the leftmost IP from
    X-Forwarded-For (set by the proxy). Otherwise fall back to REMOTE_ADDR.
    This prevents arbitrary spoofing from untrusted sources.
    """
    remote_addr = request.META.get("REMOTE_ADDR", "0.0.0.0")
    trusted_proxies = getattr(settings, "TRUSTED_PROXIES", [])
    if remote_addr in trusted_proxies:
        xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if xff:
            return xff.split(",")[0].strip()
    return remote_addr


class CreateShareView(APIView):
    permission_classes = [IsAuthenticated, IsEmailVerified]
    throttle_scope = "share_create"

    def post(self, request):
        share_types = request.data.get("shareTypes") or request.data.get("share_types") or []
        pin = request.data.get("pin") or None
        try:
            token, package = create_share(request.user, share_types, pin)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "packageId": str(package.id),
                "shareUrl": f"{settings.SHARE_PUBLIC_URL}?token={token}",
                "expiresAt": package.expires_at.isoformat(),
            },
            status=status.HTTP_201_CREATED,
        )


class ResolveShareView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "share_resolve"

    def post(self, request):
        token = request.data.get("token")
        if not token:
            return Response({"error": "token required"}, status=status.HTTP_400_BAD_REQUEST)
        client_ip = get_client_ip(request)
        result = resolve_share(token, request.data.get("pin"), client_ip=client_ip)
        return Response(result, status=result.pop("status", status.HTTP_200_OK))
