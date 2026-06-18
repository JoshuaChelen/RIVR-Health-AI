"""Transparent application-layer field encryption for direct-identifier PII.

These custom Django field types encrypt their value on the way into the
database (``get_prep_value``) and decrypt it on the way out
(``from_db_value``), so model attribute access stays plaintext — Python code
(the AI pipeline, serializers, admin detail view) reads/writes normal strings
and dates and never sees ciphertext.

Crypto: ``cryptography.fernet`` (AES-128-CBC + HMAC-SHA256, authenticated,
versioned token format). The key is a urlsafe-base64 Fernet key read from
``settings.FIELD_ENCRYPTION_KEY``. ``MultiFernet`` is used so the active key
encrypts and any number of older keys can still decrypt — that is the rotation
path (see backend/docs/COMPLIANCE.md).

Storage: ciphertext is a urlsafe-base64 token that is longer than the
plaintext and is never a valid date, so every encrypted field is backed by a
TEXT column regardless of the logical type.

IMPORTANT: encrypted columns cannot be filtered, ordered, or aggregated in the
database. Only encrypt fields that are never used in a DB query (verified for
the seven UserProfile identifier fields in Phase 7 Run B).
"""
from __future__ import annotations

from datetime import date
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import models
from django.utils.dateparse import parse_date


@lru_cache(maxsize=1)
def _fernet() -> MultiFernet:
    """Build the MultiFernet from settings.FIELD_ENCRYPTION_KEY(S).

    Accepts a single key (str) or a list/tuple of keys for rotation. The first
    key encrypts; all keys can decrypt. Cached so we don't re-parse per value.
    Raises ImproperlyConfigured on a missing/invalid key — prod.py also checks
    this up front so the failure is at boot, not on first write.
    """
    keys = getattr(settings, "FIELD_ENCRYPTION_KEY", None)
    if not keys:
        raise ImproperlyConfigured(
            "FIELD_ENCRYPTION_KEY is not set. It must be a urlsafe-base64 Fernet "
            "key. Generate one with: python -c "
            "'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
        )
    if isinstance(keys, (str, bytes)):
        keys = [keys]
    try:
        return MultiFernet([Fernet(k) for k in keys])
    except (ValueError, TypeError) as exc:
        raise ImproperlyConfigured(
            f"FIELD_ENCRYPTION_KEY is not a valid Fernet key: {exc}"
        ) from exc


def encrypt_str(plaintext: str) -> str:
    """Encrypt a plaintext string to a urlsafe-base64 token string."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_str(token: str) -> str:
    """Decrypt a token string back to plaintext."""
    return _fernet().decrypt(token.encode("ascii")).decode("utf-8")


def _looks_encrypted(value: str) -> bool:
    """Best-effort check that a value is one of our Fernet tokens.

    Used by the data migration to stay idempotent: a value that already
    decrypts is left alone, so re-running the migration can't double-encrypt.
    """
    try:
        _fernet().decrypt(value.encode("ascii"))
        return True
    except (InvalidToken, ValueError, TypeError):
        return False


class _EncryptedMixin:
    """Shared encrypt/decrypt plumbing for encrypted field types.

    Empty string and NULL are passed through untouched (never encrypted) so
    blank/optional fields keep their natural empty/NULL representation and stay
    cheap to store and compare for blank-ness.
    """

    def get_internal_type(self):  # noqa: D401 - Django field hook
        # Force a TEXT column: ciphertext is longer than the source type's max
        # and (for dates) is not date-shaped.
        return "TextField"

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if value is None or value == "":
            return value
        return encrypt_str(value)

    def from_db_value(self, value, expression, connection):
        if value is None or value == "":
            return value
        try:
            return decrypt_str(value)
        except (InvalidToken, ValueError, TypeError):
            # Tolerate any not-yet-migrated plaintext row: return it as-is rather
            # than 500. The data migration converts these; this is a safety net.
            return value


class EncryptedCharField(_EncryptedMixin, models.CharField):
    """CharField stored encrypted as TEXT; reads back as plaintext str."""


class EncryptedTextField(_EncryptedMixin, models.TextField):
    """TextField stored encrypted as TEXT; reads back as plaintext str."""


class EncryptedEmailField(_EncryptedMixin, models.EmailField):
    """EmailField stored encrypted as TEXT.

    Subclasses EmailField (not CharField) so DRF's ModelSerializer still maps it
    to an email-validating serializer field; the format check runs on the
    plaintext at the (de)serialization layer, never on ciphertext.
    """


class EncryptedDateField(models.DateField):
    """DateField stored encrypted as TEXT.

    The date is serialized to an ISO ``YYYY-MM-DD`` string, encrypted, and
    stored as TEXT. On read it is decrypted and parsed back to a ``date``.
    NULL is passed through untouched.
    """

    def get_internal_type(self):
        return "TextField"

    def get_prep_value(self, value):
        # DateField.get_prep_value would coerce to a date / SQL-date param; we
        # need an ISO string to encrypt instead, so convert directly.
        value = self.to_python(value)
        if value is None:
            return value
        return encrypt_str(value.isoformat())

    def from_db_value(self, value, expression, connection):
        if value is None:
            return value
        try:
            decrypted = decrypt_str(value)
        except (InvalidToken, ValueError, TypeError):
            # Not-yet-migrated plaintext date string — parse as-is.
            return parse_date(value) if isinstance(value, str) else value
        return parse_date(decrypted)

    def to_python(self, value):
        if isinstance(value, str) and value:
            # A stored token isn't a date; defer to from_db_value for tokens.
            parsed = parse_date(value)
            if parsed is not None:
                return parsed
        if value is None or isinstance(value, date):
            return value
        return super().to_python(value)
