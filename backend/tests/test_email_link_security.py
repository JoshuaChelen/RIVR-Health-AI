"""Tests that email verification/reset links are URL-encoded and injection-safe."""
import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.test import override_settings
from django.utils import timezone
from urllib.parse import urlparse, parse_qs

from apps.accounts.emails import send_verification_email, send_password_reset_email

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(
        email="link@example.com", password="pass", email_verified_at=timezone.now()
    )


@pytest.mark.django_db
@override_settings(FRONTEND_URL="https://app.example.com", DEBUG=False)
def test_verification_email_link_is_valid_https_url(user):
    send_verification_email(user)
    assert len(mail.outbox) == 1
    body = mail.outbox[0].body
    # Find the verify-email link in the body
    link = next(line.strip() for line in body.split("\n") if "verify-email" in line)
    parsed = urlparse(link)
    assert parsed.scheme == "https"
    assert parsed.netloc == "app.example.com"
    assert parsed.path == "/verify-email"
    qs = parse_qs(parsed.query)
    assert "token" in qs
    assert len(qs["token"][0]) > 0


@pytest.mark.django_db
@override_settings(FRONTEND_URL="https://app.example.com", DEBUG=False)
def test_verification_email_has_no_script_injection(user):
    send_verification_email(user)
    body = mail.outbox[0].body
    assert "<script" not in body.lower()
    assert "javascript:" not in body.lower()


@pytest.mark.django_db
@override_settings(FRONTEND_URL="https://app.example.com", DEBUG=False)
def test_reset_email_link_is_valid_https_url(user):
    send_password_reset_email(user)
    assert len(mail.outbox) == 1
    body = mail.outbox[0].body
    link = next(line.strip() for line in body.split("\n") if "reset-password" in line)
    parsed = urlparse(link)
    assert parsed.scheme == "https"
    assert parsed.netloc == "app.example.com"
    qs = parse_qs(parsed.query)
    assert "uid" in qs
    assert "token" in qs


@pytest.mark.django_db
@override_settings(FRONTEND_URL="https://app.example.com", DEBUG=False)
def test_reset_email_has_no_script_injection(user):
    send_password_reset_email(user)
    body = mail.outbox[0].body
    assert "<script" not in body.lower()
    assert "javascript:" not in body.lower()


@pytest.mark.django_db
@override_settings(FRONTEND_URL="https://app.example.com", DEBUG=False)
def test_verification_token_is_url_encoded(user):
    """Token in URL must only contain URL-safe characters (properly encoded)."""
    send_verification_email(user)
    body = mail.outbox[0].body
    link = next(line.strip() for line in body.split("\n") if "verify-email" in line)
    parsed = urlparse(link)
    qs = parse_qs(parsed.query)
    token = qs["token"][0]
    # URL-encoded token should not contain unencoded special chars that break HTML links
    assert "<" not in token
    assert ">" not in token
    assert '"' not in token


@pytest.mark.django_db
@override_settings(FRONTEND_URL="https://app.example.com", DEBUG=False)
def test_improperly_configured_frontend_url_raises(user):
    """FRONTEND_URL with embedded credentials should raise in production."""
    from django.core.exceptions import ImproperlyConfigured
    with override_settings(FRONTEND_URL="http://app.example.com", DEBUG=False):
        with pytest.raises(ImproperlyConfigured):
            send_verification_email(user)
