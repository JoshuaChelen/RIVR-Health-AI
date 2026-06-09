from django.utils import timezone
from rest_framework import status
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import UserProfile
from .serializers import UserProfileSerializer


class MyProfileView(RetrieveUpdateAPIView):
    """GET/PUT/PATCH the current user's profile (auto-created on first access)."""

    serializer_class = UserProfileSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self) -> UserProfile:
        return UserProfile.for_user(self.request.user)


class _HealthLinkBase(APIView):
    permission_classes = [IsAuthenticated]
    linked = True

    def post(self, request):
        profile = UserProfile.for_user(request.user)
        profile.health_linked_at = timezone.now() if self.linked else None
        profile.save(update_fields=["health_linked_at", "updated_at"])
        return Response({"health_linked_at": profile.health_linked_at}, status=status.HTTP_200_OK)


class LinkHealthView(_HealthLinkBase):
    pass


class UnlinkHealthView(_HealthLinkBase):
    linked = False
