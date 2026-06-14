"""Production settings.

Activated with ``DJANGO_SETTINGS_MODULE=config.settings.prod``. All
security-sensitive values come from the environment (see deploy ``.env.prod``):
``DJANGO_SECRET_KEY``, ``DJANGO_ALLOWED_HOSTS``, ``DATABASE_URL``, ``AWS_*``,
``CORS_*``. Runs behind Caddy, which terminates TLS and proxies plain HTTP to
gunicorn.
"""
from .base import *  # noqa: F401,F403

DEBUG = False

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
CSRF_TRUSTED_ORIGINS = env.list(  # noqa: F405
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    default=["https://api.rivrhealth.com"],
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
