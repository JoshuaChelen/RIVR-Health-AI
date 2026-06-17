from django.urls import path

from . import views
from .ai_item_views import (
    AiItemConfirmView, AiItemEditView, AiItemRejectView, AiItemSourcesView,
)
from .avatar_views import AvatarView

urlpatterns = [
    path("profile", views.MyProfileView.as_view(), name="my-profile"),
    path("profile/link-health", views.LinkHealthView.as_view(), name="link-health"),
    path("profile/unlink-health", views.UnlinkHealthView.as_view(), name="unlink-health"),
    path("profile/avatar", AvatarView.as_view(), name="avatar"),
    path("profile/ai-items/<str:item_id>/confirm", AiItemConfirmView.as_view(), name="ai-item-confirm"),
    path("profile/ai-items/<str:item_id>/reject", AiItemRejectView.as_view(), name="ai-item-reject"),
    path("profile/ai-items/<str:item_id>/sources", AiItemSourcesView.as_view(), name="ai-item-sources"),
    path("profile/ai-items/<str:item_id>", AiItemEditView.as_view(), name="ai-item-edit"),
]
