"""Production settings.

Activated with ``DJANGO_SETTINGS_MODULE=config.settings.prod``. All
security-sensitive values come from the environment (see deploy ``.env.prod``):
``DJANGO_SECRET_KEY``, ``DJANGO_ALLOWED_HOSTS``, ``DATABASE_URL``, ``AWS_*``,
``CORS_*``. Runs behind Caddy, which terminates TLS and proxies plain HTTP to
gunicorn.
"""
import os
import re

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F401,F403

DEBUG = False

# --- Fail-closed SECRET_KEY validation ----------------------------------------
_dev_insecure_key = "dev-insecure-change-me-0123456789-abcdefghijklmnopqrstuvwxyz"
if SECRET_KEY == _dev_insecure_key:  # noqa: F405
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY is set to the insecure hardcoded default. "
        "Production must have a real SECRET_KEY in environment. "
        "Generate: python -c 'from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())'"
    )
if not SECRET_KEY or len(SECRET_KEY) < 50:  # noqa: F405
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY missing or too short (must be >= 50 chars). "
        "Set a strong random key in environment; never rely on defaults in production."
    )

# --- Fail-closed FIELD_ENCRYPTION_KEY validation -------------------------------
# The seven UserProfile identifier fields are encrypted at rest with this key.
# Reject the insecure dev/CI default, an empty key, or anything cryptography
# can't parse as a Fernet key — production must boot with a real key from env.
# (base.py's _dev_insecure_field_key isn't star-imported — underscore name —
# so the insecure default value is repeated here, mirroring _dev_insecure_key.)
_dev_insecure_field_key = "c2fNUbFUXwFYVDqKHRgFOysUwAYMBtDaRW0pF5ehoE8="
if (
    not FIELD_ENCRYPTION_KEY  # noqa: F405
    or _dev_insecure_field_key in set(FIELD_ENCRYPTION_KEY)  # noqa: F405
):
    raise ImproperlyConfigured(
        "FIELD_ENCRYPTION_KEY is missing or set to the insecure hardcoded default. "
        "Production must have a real Fernet key in environment. Generate: "
        "python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
    )
try:
    from cryptography.fernet import Fernet, MultiFernet

    MultiFernet([Fernet(k) for k in FIELD_ENCRYPTION_KEY])  # noqa: F405
except Exception as exc:  # noqa: BLE001 - re-raised as config error below
    raise ImproperlyConfigured(
        f"FIELD_ENCRYPTION_KEY is not a valid Fernet key (or list of keys): {exc}"
    )

# --- Fail-closed ALLOWED_HOSTS validation --------------------------------------
# Reject empty or any list containing the wildcard (e.g. ["*", "api.example.com"]).
if not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:  # noqa: F405
    raise ImproperlyConfigured(
        "DJANGO_ALLOWED_HOSTS must be explicitly set in production and "
        "must not contain the wildcard '*'. Set "
        "DJANGO_ALLOWED_HOSTS=api.example.com,www.example.com "
        "in environment, or it defaults to unsafe ['*']."
    )

# Caddy terminates TLS and forwards the original scheme in this header, so
# Django treats proxied requests as secure (correct request.is_secure(),
# cookies, CSRF). We do NOT enable SECURE_SSL_REDIRECT — Caddy already serves
# HTTPS, and redirecting here would loop.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True
SECURE_SSL_REDIRECT = False

# Session/admin cookies over HTTPS only. The mobile API uses header-based JWT
# auth (no cookies), so this only affects the Django admin / web sessions.
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# Security response headers. Caddy serves HTTPS, so HSTS is safe; default to one
# year and allow disabling via env (set DJANGO_HSTS_SECONDS=0) before the domain
# is fully cut over. The nosniff/referrer headers are cheap defense-in-depth.
SECURE_HSTS_SECONDS = env.int("DJANGO_HSTS_SECONDS", default=31536000)  # noqa: F405
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SECURE_BROWSER_XSS_FILTER = True

# Self-hosted MinIO behind the internal docker hostname (minio:9000) yields
# signed URLs that devices/simulators can't reach. We rewrite the host via
# AWS_S3_PUBLIC_ENDPOINT_URL; fail fast in prod if the internal endpoint is used
# without a reachable public endpoint, rather than serving dead media links.
if "minio:9000" in AWS_S3_ENDPOINT_URL and not AWS_S3_PUBLIC_ENDPOINT_URL:  # noqa: F405
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured(
        "AWS_S3_ENDPOINT_URL points at the internal MinIO host (minio:9000) but "
        "AWS_S3_PUBLIC_ENDPOINT_URL is unset — signed media URLs would be "
        "unreachable by clients. Set AWS_S3_PUBLIC_ENDPOINT_URL to the public "
        "storage URL (e.g. https://api.rivrhealth.ai)."
    )
CSRF_TRUSTED_ORIGINS = env.list(  # noqa: F405
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    default=["https://api.rivrhealth.ai"],
)

# Fail-closed: CSRF_TRUSTED_ORIGINS must use the https scheme in production.
# Caddy serves HTTPS, so a non-https trusted origin is a real misconfiguration
# that opens a protocol-downgrade vector.
for _origin in CSRF_TRUSTED_ORIGINS:
    if not _origin.startswith("https://"):
        raise ImproperlyConfigured(
            f"CSRF_TRUSTED_ORIGIN {_origin} must use the https scheme in production. "
            "Non-HTTPS origins are vulnerable to protocol-downgrade attacks. "
            "Set DJANGO_CSRF_TRUSTED_ORIGINS to https:// origins only."
        )

# CORS: fail closed in production. base.py defaults CORS_ALLOW_ALL_ORIGINS to
# True (dev-friendly); pin a secure default here so a missing env var doesn't
# silently open the API to every origin. The mobile app is native (no CORS), so
# this only governs browser/web clients — set CORS_ALLOWED_ORIGINS (or, if you
# must, CORS_ALLOW_ALL_ORIGINS) in the environment to match the web app.
CORS_ALLOW_ALL_ORIGINS = env.bool("CORS_ALLOW_ALL_ORIGINS", default=False)  # noqa: F405
CORS_ALLOWED_ORIGINS = env.list(  # noqa: F405
    "CORS_ALLOWED_ORIGINS",
    default=["https://rivrhealth.ai", "https://rivrhealth.com"],
)

# --- Fail-closed CORS validation -----------------------------------------------
if CORS_ALLOW_ALL_ORIGINS:
    raise ImproperlyConfigured(
        "CORS_ALLOW_ALL_ORIGINS is True in production. This allows any origin to "
        "make cross-origin requests. Set CORS_ALLOW_ALL_ORIGINS=false and configure "
        "CORS_ALLOWED_ORIGINS explicitly (default: ['https://rivrhealth.ai', 'https://rivrhealth.com'])."
    )

# --- Fail-closed database SSL/TLS validation -----------------------------------
# Require DATABASE_URL to be set and to be a postgres URL, then enforce sslmode.
# A missing DATABASE_URL must NOT fall back to base.py's plaintext localhost
# default — that would silently boot prod on an unencrypted connection.
_raw_db_url = os.environ.get("DATABASE_URL", "")
if not _raw_db_url or "postgres" not in _raw_db_url:
    raise ImproperlyConfigured(
        "DATABASE_URL must be explicitly set to a PostgreSQL URL in production. "
        "Example: postgres://user:pass@host:5432/db?sslmode=require"
    )
if "sslmode" not in _raw_db_url:
    raise ImproperlyConfigured(
        "PostgreSQL database URL must include sslmode parameter in production. "
        "Example: postgres://user:pass@host:5432/db?sslmode=require"
    )
# Only allow require or verify-full (boundary-anchored so sslmode=requirex is
# rejected); reject allow, disable, prefer.
if not re.search(r"sslmode=(require|verify-full)(\b|&|$)", _raw_db_url):
    raise ImproperlyConfigured(
        "DATABASE_URL sslmode must be 'require' or 'verify-full' (for mutual TLS), "
        "not 'allow', 'disable', or 'prefer' (which permit fallback to unencrypted). "
        "Set: postgres://...?sslmode=require"
    )

# --- Fail-closed Redis (throttle cache + Celery broker) ------------------------
# CACHES (base.py) and Celery fall back to localhost when these are unset, which
# silently breaks every throttled endpoint (login / password-reset / share
# resolve -> 500) and the Celery worker. Require real, non-localhost redis URLs.
for _redis_var in ("REDIS_URL", "CELERY_BROKER_URL"):
    _redis_val = os.environ.get(_redis_var, "")
    if not _redis_val or "localhost" in _redis_val or "127.0.0.1" in _redis_val:
        raise ImproperlyConfigured(
            f"{_redis_var} must be set in production to a non-localhost redis:// URL "
            "(e.g. redis://redis:6379/N)."
        )

# Log to stdout so `docker compose logs` captures everything.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "simple": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "simple"},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}
