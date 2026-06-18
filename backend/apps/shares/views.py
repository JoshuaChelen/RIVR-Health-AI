from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated

from apps.common.permissions import IsEmailVerified
from rest_framework.response import Response
from rest_framework.views import APIView

from .services import create_share, resolve_share


class CreateShareView(APIView):
    permission_classes = [IsAuthenticated, IsEmailVerified]

    def post(self, request):
        share_types = request.data.get("shareTypes") or request.data.get("share_types") or []
        pin = request.data.get("pin") or None
        token, package = create_share(request.user, share_types, pin)
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
        result = resolve_share(token, request.data.get("pin"))
        return Response(result, status=result.pop("status", status.HTTP_200_OK))
