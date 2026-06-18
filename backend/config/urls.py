from django.conf import settings
from django.contrib import admin
from django.http import HttpRequest, JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.accounts.account_views import DeleteAccountView


def healthz(_request: HttpRequest) -> JsonResponse:
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("healthz", healthz, name="healthz"),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/", include("apps.profiles.urls")),
    path("api/", include("apps.documents.urls")),
    path("api/", include("apps.timeline.urls")),
    path("api/", include("apps.health.urls")),
    path("api/", include("apps.jobs.urls")),
    path("api/", include("apps.shares.urls")),
    path("api/account", DeleteAccountView.as_view(), name="delete-account"),
]

# Gate Django admin and API documentation behind DEBUG flag.
# In production (DEBUG=False), these routes are not registered and return 404.
if settings.DEBUG:
    urlpatterns += [
        path("admin/", admin.site.urls),
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
    ]
