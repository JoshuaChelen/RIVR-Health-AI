import logging
from urllib.parse import quote, urlparse

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail import send_mail

from .tokens import make_email_verify_token, make_password_reset_tokens

logger = logging.getLogger(__name__)


def _get_safe_frontend_url() -> str:
    """Return FRONTEND_URL, validating it is https in non-debug/non-localhost environments."""
    url = settings.FRONTEND_URL
    if not settings.DEBUG:
        parsed = urlparse(url)
        is_localhost = parsed.hostname in ("localhost", "127.0.0.1")
        if not is_localhost and (
            parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password
        ):
            raise ImproperlyConfigured(
                f"FRONTEND_URL must be an https URL without credentials in production, got: {url!r}"
            )
    return url


def _safe_send(subject: str, message: str, recipient: str) -> None:
    """Send an email; never let a mail-server outage break the request flow."""
    try:
        send_mail(
            subject=subject,
            message=message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient],
        )
    except Exception:  # pragma: no cover - depends on mail infra
        logger.exception("Failed to send email to %s", recipient)


def send_verification_email(user) -> None:
    token = quote(make_email_verify_token(user), safe="")
    link = f"{_get_safe_frontend_url()}/verify-email?token={token}"
    _safe_send(
        "Verify your RIVR email",
        f"Welcome to RIVR.\n\nVerify your email address:\n{link}\n",
        user.email,
    )


def send_password_reset_email(user) -> None:
    uid, token = make_password_reset_tokens(user)
    link = f"{_get_safe_frontend_url()}/reset-password?uid={quote(uid, safe='')}&token={quote(token, safe='')}"
    _safe_send(
        "Reset your RIVR password",
        f"Reset your password:\n{link}\n\nIf you didn't request this, ignore this email.\n",
        user.email,
    )
