from .base import *  # noqa: F401,F403

# Tests run against Postgres (ArrayField is Postgres-only) but optimise the
# rest of the stack for speed and isolation.
DEBUG = False
CELERY_TASK_ALWAYS_EAGER = True
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
MIDDLEWARE = [m for m in MIDDLEWARE if "whitenoise" not in m]  # noqa: F405
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

# Use in-memory cache regardless of DEBUG so lockout/denylist tests are isolated.
CACHES = {  # noqa: F405
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "rivr-test-cache",
    }
}

REST_FRAMEWORK = {  # noqa: F405
    **REST_FRAMEWORK,  # noqa: F405
    "NUM_PROXIES": 0,
    "DEFAULT_THROTTLE_RATES": {
        "share_resolve": "10000/min",
        "share_create": "10000/min",
        "register": "10000/min",
        "login": "10000/min",
        "upload": "10000/min",
        "qa_calls": "10000/min",
        "password_reset": "10000/min",
    },
}
