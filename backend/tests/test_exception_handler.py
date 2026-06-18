"""Tests for the custom DRF exception handler (sanitizes PHI from error responses)."""
import pytest
from rest_framework.exceptions import ValidationError, NotFound
from rest_framework.test import APIRequestFactory

from apps.common.exception_handler import custom_exception_handler


def _ctx():
    factory = APIRequestFactory()
    request = factory.get("/")
    return {"request": request, "view": None}


def test_handler_sanitizes_phi_in_detail():
    # DRF ValidationError with a dict wraps as {"detail": ErrorDetail}
    from rest_framework.exceptions import APIException
    exc = APIException("Patient SSN 123-45-6789 is invalid")
    response = custom_exception_handler(exc, _ctx())
    assert response is not None
    detail_str = str(response.data.get("detail", ""))
    assert "123-45-6789" not in detail_str
    assert "[SSN]" in detail_str


def test_handler_sanitizes_email_in_detail():
    from rest_framework.exceptions import APIException
    exc = APIException("Error for user@example.com")
    response = custom_exception_handler(exc, _ctx())
    assert response is not None
    detail_str = str(response.data.get("detail", ""))
    assert "user@example.com" not in detail_str


def test_handler_sanitizes_file_path_in_detail():
    from rest_framework.exceptions import APIException
    exc = APIException("Error in /home/rivr/backend/app.py")
    response = custom_exception_handler(exc, _ctx())
    assert response is not None
    detail_str = str(response.data.get("detail", ""))
    assert "/home/rivr/backend/app.py" not in detail_str


def test_handler_sanitizes_validation_error_string():
    """ValidationError with a string gets wrapped as list by DRF — still sanitized."""
    exc = ValidationError("SSN 123-45-6789 is invalid")
    response = custom_exception_handler(exc, _ctx())
    assert response is not None
    # Response data is a list of ErrorDetail strings
    body_str = str(response.data)
    assert "123-45-6789" not in body_str


def test_handler_returns_none_for_non_drf_exception():
    # Non-DRF exceptions are NOT handled by DRF's default handler either
    exc = RuntimeError("Something internal broke")
    response = custom_exception_handler(exc, _ctx())
    # DRF's default handler returns None for non-DRF exceptions; so should ours
    assert response is None


def test_handler_preserves_status_code():
    exc = NotFound("Resource not found")
    response = custom_exception_handler(exc, _ctx())
    assert response is not None
    assert response.status_code == 404


def test_handler_handles_list_style_validation_errors():
    exc = ValidationError({"field": ["This field is required."]})
    response = custom_exception_handler(exc, _ctx())
    assert response is not None
    assert response.status_code == 400


def test_exception_handler_is_wired_in_settings():
    from django.conf import settings
    handler = settings.REST_FRAMEWORK.get("EXCEPTION_HANDLER")
    assert handler == "apps.common.exception_handler.custom_exception_handler"


def test_handler_does_not_truncate_client_message():
    """Validation messages returned to clients must not be cut at 500 chars."""
    from rest_framework.exceptions import APIException
    long_msg = "This field is invalid because " + ("reason " * 120)  # > 500 chars
    exc = APIException(long_msg)
    response = custom_exception_handler(exc, _ctx())
    assert response is not None
    detail_str = str(response.data.get("detail", ""))
    assert len(detail_str) > 500
