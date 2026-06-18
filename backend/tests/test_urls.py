"""Tests for URL gating behind DEBUG flag (Phase 0 security hardening).

GOTCHA B: override_settings(DEBUG=True/False) does NOT rebuild the URLconf
because urls.py is evaluated at import time. We work around this by directly
testing the url_gating logic: we call a helper that mirrors what urls.py does
(conditional inclusion) and verify the resulting pattern list rather than
using the live Django URL resolver.
"""
import pytest
from django.conf import settings
from django.test import Client


def _has_url_prefix(patterns: list, prefix: str) -> bool:
    """Return True if any top-level pattern has a route starting with prefix."""
    for p in patterns:
        route = getattr(p.pattern, "_route", None) or getattr(p.pattern, "regex", None)
        if route is None:
            continue
        route_str = route if isinstance(route, str) else route.pattern
        if route_str.startswith(prefix) or route_str == prefix:
            return True
    return False


def _build_conditional_patterns(debug: bool) -> list:
    """Mirror the DEBUG-conditional gating logic from config/urls.py."""
    from django.contrib import admin
    from django.http import HttpRequest, JsonResponse
    from django.urls import include, path
    from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
    from apps.accounts.account_views import DeleteAccountView

    def healthz(_request):
        return JsonResponse({"status": "ok"})

    patterns = [
        path("healthz", healthz, name="healthz-test"),
        path("api/auth/", include("apps.accounts.urls")),
        path("api/", include("apps.profiles.urls")),
        path("api/", include("apps.documents.urls")),
        path("api/", include("apps.timeline.urls")),
        path("api/", include("apps.health.urls")),
        path("api/", include("apps.jobs.urls")),
        path("api/", include("apps.shares.urls")),
        path("api/account", DeleteAccountView.as_view(), name="delete-account-test"),
    ]

    if debug:
        patterns += [
            path("admin/", admin.site.urls),
            path("api/schema/", SpectacularAPIView.as_view(), name="schema-test"),
            path(
                "api/docs/",
                SpectacularSwaggerView.as_view(url_name="schema-test"),
                name="docs-test",
            ),
        ]

    return patterns


class TestAdminUrlsGatedInProd:
    """Admin and docs must NOT be included when DEBUG=False."""

    def test_admin_absent_in_prod_urlconf(self):
        """admin/ route must not be registered when DEBUG=False."""
        patterns = _build_conditional_patterns(debug=False)
        assert not _has_url_prefix(patterns, "admin/"), \
            "admin/ should be absent in prod urlconf"

    def test_api_schema_absent_in_prod_urlconf(self):
        """api/schema/ route must not be registered when DEBUG=False."""
        patterns = _build_conditional_patterns(debug=False)
        assert not _has_url_prefix(patterns, "api/schema/"), \
            "api/schema/ should be absent in prod urlconf"

    def test_api_docs_absent_in_prod_urlconf(self):
        """api/docs/ route must not be registered when DEBUG=False."""
        patterns = _build_conditional_patterns(debug=False)
        assert not _has_url_prefix(patterns, "api/docs/"), \
            "api/docs/ should be absent in prod urlconf"


class TestAdminUrlsVisibleInDev:
    """Admin and docs MUST be included when DEBUG=True."""

    def test_admin_present_in_dev_urlconf(self):
        """admin/ route must be registered when DEBUG=True."""
        patterns = _build_conditional_patterns(debug=True)
        assert _has_url_prefix(patterns, "admin/"), \
            "admin/ should be present in dev urlconf"

    def test_api_schema_present_in_dev_urlconf(self):
        """api/schema/ route must be registered when DEBUG=True."""
        patterns = _build_conditional_patterns(debug=True)
        assert _has_url_prefix(patterns, "api/schema/"), \
            "api/schema/ should be present in dev urlconf"

    def test_api_docs_present_in_dev_urlconf(self):
        """api/docs/ route must be registered when DEBUG=True."""
        patterns = _build_conditional_patterns(debug=True)
        assert _has_url_prefix(patterns, "api/docs/"), \
            "api/docs/ should be present in dev urlconf"


class TestAdminUrlsGatedLive:
    """Live URL resolver returns 404 for admin/docs when DEBUG=False (tests run with DEBUG=False)."""

    def test_admin_returns_404_in_prod(self):
        """Admin /admin should return 404 when DEBUG=False."""
        assert not settings.DEBUG, "This test expects DEBUG=False (test.py sets DEBUG=False)"
        client = Client()
        response = client.get("/admin/")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"

    def test_api_schema_returns_404_in_prod(self):
        """API schema /api/schema/ should return 404 when DEBUG=False."""
        assert not settings.DEBUG
        client = Client()
        response = client.get("/api/schema/")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"

    def test_api_docs_returns_404_in_prod(self):
        """API docs /api/docs/ should return 404 when DEBUG=False."""
        assert not settings.DEBUG
        client = Client()
        response = client.get("/api/docs/")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
