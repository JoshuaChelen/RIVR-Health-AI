from django.urls import path

from .views import CreateShareView, ResolveShareView

urlpatterns = [
    path("shares", CreateShareView.as_view(), name="create-share"),
    path("shares/resolve", ResolveShareView.as_view(), name="resolve-share"),
]
