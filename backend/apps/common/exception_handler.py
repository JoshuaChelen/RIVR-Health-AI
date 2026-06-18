"""Custom DRF exception handler — sanitizes PHI/secrets from error responses.

Wraps the standard DRF handler so that validation errors, 500s, and any other
error responses can never leak file paths, emails, SSNs, or credentials to API
clients.
"""
from rest_framework.views import exception_handler as drf_exception_handler

from apps.jobs.error_sanitizer import sanitize_response_detail


def custom_exception_handler(exc, context):
    """Pass through to DRF's default handler, then sanitize the response body."""
    response = drf_exception_handler(exc, context)
    if response is not None and response.data is not None:
        response.data = sanitize_response_detail(response.data)
    return response
