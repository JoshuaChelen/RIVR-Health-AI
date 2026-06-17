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

    AI_FIELDS = ["allergies", "medications", "medical_history", "surgical_history"]
    PRESERVE = ("review_status", "reviewed_at", "ai_original")

    def get_object(self) -> UserProfile:
        return UserProfile.for_user(self.request.user)

    def perform_update(self, serializer):
        from apps.jobs.profile_logic import is_ai_backfilled
        instance = serializer.instance
        before = {
            f: {it.get("id"): it for it in (getattr(instance, f) or [])
                if isinstance(it, dict) and is_ai_backfilled(it.get("id"))}
            for f in self.AI_FIELDS
        }
        obj = serializer.save()
        changed = []
        for f in self.AI_FIELDS:
            arr = getattr(obj, f) or []
            touched = False
            for it in arr:
                if isinstance(it, dict) and is_ai_backfilled(it.get("id")):
                    prev = before[f].get(it.get("id"))
                    if prev:
                        for k in self.PRESERVE:
                            if k in prev and k not in it:
                                it[k] = prev[k]; touched = True
            if touched:
                changed.append(f)
        if changed:
            obj.save(update_fields=[*changed, "updated_at"])


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
