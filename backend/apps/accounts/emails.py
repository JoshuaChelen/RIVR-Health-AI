import logging
from urllib.parse import quote, urlparse

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

from .tokens import make_email_verify_token, make_password_reset_tokens

logger = logging.getLogger(__name__)

SUPPORT_EMAIL = "support@rivrhealth.ai"
# Brand/marketing site — used for the email logo and footer link. Kept independent
# of FRONTEND_URL (the app host that serves the verify/reset/share pages), which
# does not serve /logo/Logo.png.
BRAND_URL = "https://rivrhealth.ai"
LOGO_URL = f"{BRAND_URL}/logo/Logo.png"


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


def _send_branded(subject: str, recipient: str, context: dict) -> None:
    """Render the branded HTML+text email and send it; never let mail issues break the flow."""
    ctx = {
        "support_email": SUPPORT_EMAIL,
        "frontend_url": BRAND_URL,
        "logo_url": LOGO_URL,
        **context,
    }
    text_body = render_to_string("accounts/email/action.txt", ctx)
    html_body = render_to_string("accounts/email/action.html", ctx)
    try:
        msg = EmailMultiAlternatives(
            subject=subject,
            body=text_body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[recipient],
            reply_to=[SUPPORT_EMAIL],
        )
        msg.attach_alternative(html_body, "text/html")
        msg.send()
    except Exception:  # pragma: no cover - depends on mail infra
        logger.exception("Failed to send email to %s", recipient)


def send_verification_email(user) -> None:
    token = quote(make_email_verify_token(user), safe="")
    link = f"{_get_safe_frontend_url()}/verify-email?token={token}"
    _send_branded(
        "Verify your RIVR email",
        user.email,
        {
            "preheader": "Confirm your email to activate your RIVR account.",
            "heading": "Welcome to RIVR",
            "intro": (
                "Thanks for signing up. Confirm your email address to activate your "
                "account and start building your health timeline."
            ),
            "button_label": "Verify email",
            "button_url": link,
            "expiry": "This link expires in 24 hours.",
            "reason": "signed up",
        },
    )


def send_password_reset_email(user) -> None:
    uid, token = make_password_reset_tokens(user)
    link = (
        f"{_get_safe_frontend_url()}/reset-password"
        f"?uid={quote(uid, safe='')}&token={quote(token, safe='')}"
    )
    _send_branded(
        "Reset your RIVR password",
        user.email,
        {
            "preheader": "Reset your RIVR password — link valid for 1 hour.",
            "heading": "Reset your password",
            "intro": (
                "We received a request to reset the password for your RIVR account. "
                "Use the button below to choose a new password."
            ),
            "button_label": "Reset password",
            "button_url": link,
            "expiry": (
                "This link expires in 1 hour. If you didn't request a password reset, "
                "you can safely ignore this email."
            ),
            "reason": "requested a password reset",
        },
    )
