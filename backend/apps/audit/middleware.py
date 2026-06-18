from apps.common.ip import get_client_ip


class AuditLoggingMiddleware:
    """Attaches audit context (IP, user-agent) to each request for downstream logging."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.audit_context = {
            "ip_address": get_client_ip(request),
            "user_agent": request.META.get("HTTP_USER_AGENT", "")[:512],
        }
        if hasattr(request, "user") and request.user and request.user.is_authenticated:
            request._audit_actor = request.user
        response = self.get_response(request)
        return response
