"""Signed tokens for email verification and password reset."""
import time

from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

User = get_user_model()

EMAIL_VERIFY_SALT = "accounts.email-verify"
EMAIL_VERIFY_MAX_AGE = 60 * 60 * 24  # 1 day


def make_email_verify_token(user) -> str:
    return signing.dumps(str(user.pk), salt=EMAIL_VERIFY_SALT)


def read_email_verify_token(token: str):
    start = time.perf_counter()
    try:
        uid = signing.loads(token, salt=EMAIL_VERIFY_SALT, max_age=EMAIL_VERIFY_MAX_AGE)
    except signing.BadSignature:
        # Normalize timing to prevent user enumeration via response time.
        elapsed = time.perf_counter() - start
        if elapsed < 0.001:
            time.sleep(0.001 - elapsed)
        return None
    return User.objects.filter(pk=uid).first()


def make_password_reset_tokens(user) -> tuple[str, str]:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    return uid, default_token_generator.make_token(user)


def read_password_reset(uid: str, token: str):
    try:
        pk = force_str(urlsafe_base64_decode(uid))
    except (TypeError, ValueError, OverflowError):
        return None
    user = User.objects.filter(pk=pk).first()
    if user is None:
        return None
    # Explicit single-use check: reject if the token was already consumed.
    if user.password_reset_token_used_at is not None:
        return None
    if not default_token_generator.check_token(user, token):
        return None
    return user
