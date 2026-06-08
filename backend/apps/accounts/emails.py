from django.conf import settings
from django.core.mail import send_mail

from .tokens import make_email_verify_token, make_password_reset_tokens


def send_verification_email(user) -> None:
    token = make_email_verify_token(user)
    link = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    send_mail(
        subject="Verify your RIVR email",
        message=f"Welcome to RIVR.\n\nVerify your email address:\n{link}\n",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
    )


def send_password_reset_email(user) -> None:
    uid, token = make_password_reset_tokens(user)
    link = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
    send_mail(
        subject="Reset your RIVR password",
        message=f"Reset your password:\n{link}\n\nIf you didn't request this, ignore this email.\n",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
    )
