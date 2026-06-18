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

# --- Fail-closed ALLOWED_HOSTS validation --------------------------------------
if not ALLOWED_HOSTS or ALLOWED_HOSTS == ["*"]:  # noqa: F405
    raise ImproperlyConfigured(
        "DJANGO_ALLOWED_HOSTS must be explicitly set in production and "
        "must not be wildcard. Set DJANGO_ALLOWED_HOSTS=api.example.com,www.example.com "
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
        "storage URL (e.g. https://api.rivrhealth.com/media)."
    )
CSRF_TRUSTED_ORIGINS = env.list(  # noqa: F405
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    default=["https://api.rivrhealth.com"],
)

# Validate CSRF_TRUSTED_ORIGINS entries use secure scheme
for _origin in CSRF_TRUSTED_ORIGINS:
    if not _origin.startswith("https://"):
        import warnings
        warnings.warn(
            f"CSRF_TRUSTED_ORIGIN {_origin} should use https scheme. "
            "Non-HTTPS origins may be vulnerable to protocol-downgrade attacks.",
            category=RuntimeWarning,
        )

# CORS: fail closed in production. base.py defaults CORS_ALLOW_ALL_ORIGINS to
# True (dev-friendly); pin a secure default here so a missing env var doesn't
# silently open the API to every origin. The mobile app is native (no CORS), so
# this only governs browser/web clients — set CORS_ALLOWED_ORIGINS (or, if you
# must, CORS_ALLOW_ALL_ORIGINS) in the environment to match the web app.
CORS_ALLOW_ALL_ORIGINS = env.bool("CORS_ALLOW_ALL_ORIGINS", default=False)  # noqa: F405
CORS_ALLOWED_ORIGINS = env.list(  # noqa: F405
    "CORS_ALLOWED_ORIGINS",
    default=["https://api.rivrhealth.com", "https://rivrhealth.com"],
)

# --- Fail-closed CORS validation -----------------------------------------------
if CORS_ALLOW_ALL_ORIGINS:
    raise ImproperlyConfigured(
        "CORS_ALLOW_ALL_ORIGINS is True in production. This allows any origin to "
        "make cross-origin requests. Set CORS_ALLOW_ALL_ORIGINS=false and configure "
        "CORS_ALLOWED_ORIGINS explicitly (default: ['https://api.rivrhealth.com', 'https://rivrhealth.com'])."
    )

# --- Fail-closed database SSL/TLS validation -----------------------------------
_raw_db_url = os.environ.get("DATABASE_URL", "")
if _raw_db_url and "postgres" in _raw_db_url:
    if "sslmode" not in _raw_db_url:
        raise ImproperlyConfigured(
            "PostgreSQL database URL must include sslmode parameter in production. "
            "Example: postgres://user:pass@host:5432/db?sslmode=require"
        )
    # Only allow require or verify-full; reject allow, disable, prefer
    if not re.search(r"sslmode=(require|verify-full)", _raw_db_url):
        raise ImproperlyConfigured(
            "DATABASE_URL sslmode must be 'require' or 'verify-full' (for mutual TLS), "
            "not 'allow', 'disable', or 'prefer' (which permit fallback to unencrypted). "
            "Set: postgres://...?sslmode=require"
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
