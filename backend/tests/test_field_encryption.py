"""Tests for field-level encryption of UserProfile identifier PII (Phase 7B).

Verifies that the seven direct-identifier fields are stored as ciphertext in
the raw DB column but read back transparently as plaintext, that the encrypted
DateField round-trips, and that prod fails closed without a real key.
"""
import datetime
import os
import subprocess
import sys

import pytest
from django.db import connection

from apps.accounts.models import User
from apps.common.encryption import decrypt_str, encrypt_str
from apps.profiles.models import UserProfile

pytestmark = pytest.mark.django_db


ENCRYPTED_FIELDS = [
    "first_name",
    "last_name",
    "mobile_phone",
    "emergency_contact_name",
    "emergency_contact_phone",
    "emergency_contact_relationship",
    "email",
]


def _make_profile(**kwargs):
    user = User.objects.create_user(
        email=f"enc-{User.objects.count()}@example.com", password="x"
    )
    return UserProfile.objects.create(user=user, **kwargs)


def _raw_column(profile_id, column):
    with connection.cursor() as cur:
        cur.execute(
            f"SELECT {column} FROM user_profiles WHERE id = %s", [str(profile_id)]
        )
        return cur.fetchone()[0]


class TestRoundTrip:
    def test_char_fields_read_back_as_plaintext(self):
        p = _make_profile(
            first_name="Alice",
            last_name="Zhang",
            mobile_phone="+15551234567",
            emergency_contact_name="Bob Zhang",
            emergency_contact_phone="+15557654321",
            emergency_contact_relationship="spouse",
            email="alice@example.com",
        )
        fresh = UserProfile.objects.get(pk=p.pk)
        assert fresh.first_name == "Alice"
        assert fresh.last_name == "Zhang"
        assert fresh.mobile_phone == "+15551234567"
        assert fresh.emergency_contact_name == "Bob Zhang"
        assert fresh.emergency_contact_phone == "+15557654321"
        assert fresh.emergency_contact_relationship == "spouse"
        assert fresh.email == "alice@example.com"

    def test_date_of_birth_round_trips_as_date(self):
        p = _make_profile(date_of_birth=datetime.date(1990, 7, 4))
        fresh = UserProfile.objects.get(pk=p.pk)
        assert fresh.date_of_birth == datetime.date(1990, 7, 4)
        assert isinstance(fresh.date_of_birth, datetime.date)


class TestCiphertextAtRest:
    def test_char_field_stored_as_ciphertext(self):
        p = _make_profile(first_name="Alice", last_name="Zhang")
        raw_first = _raw_column(p.pk, "first_name")
        raw_last = _raw_column(p.pk, "last_name")
        # Raw column must NOT contain the plaintext.
        assert raw_first != "Alice"
        assert "Alice" not in raw_first
        assert raw_last != "Zhang"
        # But the raw token must decrypt back to the plaintext.
        assert decrypt_str(raw_first) == "Alice"
        assert decrypt_str(raw_last) == "Zhang"

    def test_date_stored_as_ciphertext(self):
        p = _make_profile(date_of_birth=datetime.date(1990, 7, 4))
        raw = _raw_column(p.pk, "date_of_birth")
        assert "1990" not in raw
        assert raw != "1990-07-04"
        assert decrypt_str(raw) == "1990-07-04"

    def test_email_stored_as_ciphertext(self):
        p = _make_profile(email="secret@phi.example")
        raw = _raw_column(p.pk, "email")
        assert "secret@phi.example" not in raw
        assert decrypt_str(raw) == "secret@phi.example"


class TestEmptyAndNull:
    def test_blank_strings_not_encrypted(self):
        p = _make_profile()  # all char fields default to ""
        raw = _raw_column(p.pk, "first_name")
        assert raw == ""  # empty passes through untouched
        fresh = UserProfile.objects.get(pk=p.pk)
        assert fresh.first_name == ""

    def test_null_date_stays_null(self):
        p = _make_profile()  # date_of_birth defaults to NULL
        raw = _raw_column(p.pk, "date_of_birth")
        assert raw is None
        fresh = UserProfile.objects.get(pk=p.pk)
        assert fresh.date_of_birth is None


class TestPrimitives:
    def test_encrypt_decrypt_round_trip(self):
        token = encrypt_str("hello PHI")
        assert token != "hello PHI"
        assert decrypt_str(token) == "hello PHI"

    def test_ciphertext_is_non_deterministic(self):
        # Fernet embeds a random IV, so two encryptions differ.
        assert encrypt_str("same") != encrypt_str("same")


class TestProdFailsClosed:
    """prod.py must raise ImproperlyConfigured without a real FIELD_ENCRYPTION_KEY."""

    _CWD = "/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend"
    _CMD = "from django.conf import settings; _ = settings.DEBUG"

    def _prod_env(self, **overrides):
        env = os.environ.copy()
        for key in (
            "FIELD_ENCRYPTION_KEY", "CORS_ALLOW_ALL_ORIGINS", "DJANGO_SECRET_KEY",
            "DJANGO_ALLOWED_HOSTS", "DATABASE_URL", "DJANGO_DEBUG",
            "DJANGO_SETTINGS_MODULE", "AWS_S3_ENDPOINT_URL", "AWS_S3_PUBLIC_ENDPOINT_URL",
        ):
            env.pop(key, None)
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"
        env["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
        env["DJANGO_SECRET_KEY"] = "x" * 60
        env["DJANGO_ALLOWED_HOSTS"] = "api.example.com"
        env["DATABASE_URL"] = "postgres://user:pass@localhost/db?sslmode=require"
        env["CORS_ALLOW_ALL_ORIGINS"] = "false"
        # A real, valid prod key by default — overridden per test.
        env["FIELD_ENCRYPTION_KEY"] = "Hh3y0p3F0t8wXp4nGq2QbVr9Yd1mZc6sJ7kLwTxNuE0="
        env["REDIS_URL"] = "redis://redis:6379/2"
        env["CELERY_BROKER_URL"] = "redis://redis:6379/0"
        env["CELERY_RESULT_BACKEND"] = "redis://redis:6379/1"
        env.update(overrides)
        return env

    def _run(self, **env_overrides):
        return subprocess.run(
            [sys.executable, "-c", self._CMD],
            env=self._prod_env(**env_overrides),
            cwd=self._CWD,
            capture_output=True,
            text=True,
        )

    def test_prod_rejects_missing_field_key(self):
        env = self._prod_env()
        env.pop("FIELD_ENCRYPTION_KEY", None)
        result = subprocess.run(
            [sys.executable, "-c", self._CMD], env=env, cwd=self._CWD,
            capture_output=True, text=True,
        )
        assert result.returncode != 0
        assert "FIELD_ENCRYPTION_KEY" in result.stderr

    def test_prod_rejects_dev_default_field_key(self):
        result = self._run(
            FIELD_ENCRYPTION_KEY="c2fNUbFUXwFYVDqKHRgFOysUwAYMBtDaRW0pF5ehoE8="
        )
        assert result.returncode != 0
        assert "FIELD_ENCRYPTION_KEY" in result.stderr

    def test_prod_rejects_invalid_field_key(self):
        result = self._run(FIELD_ENCRYPTION_KEY="not-a-valid-fernet-key")
        assert result.returncode != 0
        assert "FIELD_ENCRYPTION_KEY" in result.stderr

    def test_prod_accepts_valid_field_key(self):
        result = self._run()
        assert result.returncode == 0, f"Failed: {result.stderr}"
