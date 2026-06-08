import logging

from django.conf import settings
from django.core.mail import send_mail

from .tokens import make_email_verify_token, make_password_reset_tokens

logger = logging.getLogger(__name__)


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
    token = make_email_verify_token(user)
    link = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    _safe_send(
        "Verify your RIVR email",
        f"Welcome to RIVR.\n\nVerify your email address:\n{link}\n",
        user.email,
    )


def send_password_reset_email(user) -> None:
    uid, token = make_password_reset_tokens(user)
    link = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
    _safe_send(
        "Reset your RIVR password",
        f"Reset your password:\n{link}\n\nIf you didn't request this, ignore this email.\n",
        user.email,
    )
