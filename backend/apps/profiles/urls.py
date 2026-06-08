from django.urls import path

from . import views

urlpatterns = [
    path("profile", views.MyProfileView.as_view(), name="my-profile"),
    path("profile/link-health", views.LinkHealthView.as_view(), name="link-health"),
    path("profile/unlink-health", views.UnlinkHealthView.as_view(), name="unlink-health"),
]
