from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common import storage

from .models import UserProfile


class AvatarView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        return Response({"avatar_path": profile.avatar_path, "url": storage.signed_url(profile.avatar_path)})

    def post(self, request):
        upload = request.FILES.get("image") or request.FILES.get("file")
        if upload is None:
            return Response({"detail": "No image provided."}, status=status.HTTP_400_BAD_REQUEST)
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        key = storage.avatar_key(request.user.id)
        storage.delete(profile.avatar_path)
        saved = storage.save(key, storage.process_avatar(upload))
        profile.avatar_path = saved
        profile.save(update_fields=["avatar_path", "updated_at"])
        return Response(
            {"avatar_path": saved, "url": storage.signed_url(saved)}, status=status.HTTP_201_CREATED
        )

    def delete(self, request):
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        storage.delete(profile.avatar_path)
        profile.avatar_path = ""
        profile.save(update_fields=["avatar_path", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)
