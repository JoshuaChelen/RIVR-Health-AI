"""Base Django settings for the RIVR backend.

Values are read from the environment (see .env.example). Local defaults are
safe for development only.
"""
import os
from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
# Gate .env loading so subprocess-based tests can set DJANGO_READ_DOT_ENV_FILE=false
# and test true production validation without .env polluting the environment.
if os.environ.get("DJANGO_READ_DOT_ENV_FILE", "true").lower() != "false":
    environ.Env.read_env(BASE_DIR / ".env")

# --- Core ---------------------------------------------------------------------
SECRET_KEY = env(
    "DJANGO_SECRET_KEY",
    default="dev-insecure-change-me-0123456789-abcdefghijklmnopqrstuvwxyz",
)
DEBUG = env.bool("DJANGO_DEBUG", default=True)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["*"])

# --- Field-level encryption (direct-identifier PII) ---------------------------
# Fernet key (urlsafe-base64) used by apps.common.encryption to encrypt the
# seven UserProfile identifier fields at rest. The default below is an insecure
# dev/CI key, mirroring SECRET_KEY: prod.py fails closed if it's still in use.
# Generate a real key with:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# A single key encrypts and decrypts; supply a comma-separated list (newest
# first) to rotate (MultiFernet) — see backend/docs/COMPLIANCE.md.
# Valid Fernet key, but a public/insecure default — prod.py rejects this exact
# value so production cannot boot without a real key from the environment.
_dev_insecure_field_key = "c2fNUbFUXwFYVDqKHRgFOysUwAYMBtDaRW0pF5ehoE8="
FIELD_ENCRYPTION_KEY = env.list(
    "FIELD_ENCRYPTION_KEY",
    default=[_dev_insecure_field_key],
)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # third-party
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "corsheaders",
    "drf_spectacular",
    # local
    "apps.common",
    "apps.accounts",
    "apps.profiles",
    "apps.documents",
    "apps.timeline",
    "apps.health",
    "apps.jobs",
    "apps.shares",
    "apps.audit",
    "apps.compliance",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "apps.audit.middleware.AuditLoggingMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --- Database -----------------------------------------------------------------
DATABASES = {
    "default": env.db("DATABASE_URL", default="postgres://rivr:rivr@localhost:5432/rivr"),
}

# --- Auth ---------------------------------------------------------------------
AUTH_USER_MODEL = "accounts.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --- I18N / TZ ----------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# --- Static / media -----------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Object storage (S3 / MinIO) ----------------------------------------------
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

AWS_ACCESS_KEY_ID = env("AWS_ACCESS_KEY_ID", default="")
AWS_SECRET_ACCESS_KEY = env("AWS_SECRET_ACCESS_KEY", default="")
AWS_STORAGE_BUCKET_NAME = env("AWS_STORAGE_BUCKET_NAME", default="rivr-media")
AWS_S3_ENDPOINT_URL = env("AWS_S3_ENDPOINT_URL", default="")
AWS_S3_REGION_NAME = env("AWS_S3_REGION_NAME", default="us-east-1")
# Host used to rewrite client-facing signed URLs when the internal storage
# endpoint (e.g. the docker MinIO hostname `minio:9000`) isn't reachable from
# devices/simulators. Empty in prod, where signed URLs already use a real host.
AWS_S3_PUBLIC_ENDPOINT_URL = env("AWS_S3_PUBLIC_ENDPOINT_URL", default="")

if AWS_ACCESS_KEY_ID:
    # MinIO needs path-style addressing; signed URLs for private objects.
    AWS_S3_ADDRESSING_STYLE = "path"
    AWS_QUERYSTRING_AUTH = True
    AWS_QUERYSTRING_EXPIRE = 600
    AWS_DEFAULT_ACL = None
    AWS_S3_FILE_OVERWRITE = False
    STORAGES["default"] = {"BACKEND": "storages.backends.s3.S3Storage"}

# --- DRF ----------------------------------------------------------------------
REST_FRAMEWORK = {
    "NUM_PROXIES": env.int("DJANGO_NUM_PROXIES", default=1),
    "EXCEPTION_HANDLER": "apps.common.exception_handler.custom_exception_handler",
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.common.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "apps.common.pagination.LimitedLimitOffsetPagination",
    "PAGE_SIZE": 30,
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        "share_resolve": "30/min",
        "share_create": "10/min",
        "register": "5/h",
        "login": "10/min",
        "upload": "30/h",
        "qa_calls": "60/h",
        "password_reset": "5/h",
    },
}

SPECTACULAR_SETTINGS = {
    "TITLE": "RIVR API",
    "DESCRIPTION": "RIVR Health backend API.",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

# Django's default_token_generator respects this setting.  Pin to 1 hour so
# password-reset links can't be replayed days later.
PASSWORD_RESET_TIMEOUT = env.int("PASSWORD_RESET_TIMEOUT", default=3600)  # 1 hour

# --- Upload size limits (DoS prevention) ----------------------------------------
FILE_UPLOAD_MAX_MEMORY_SIZE = env.int(
    "FILE_UPLOAD_MAX_MEMORY_SIZE",
    default=50 * 1024 * 1024,  # 50MB
)
DATA_UPLOAD_MAX_MEMORY_SIZE = env.int(
    "DATA_UPLOAD_MAX_MEMORY_SIZE",
    default=10 * 1024 * 1024,  # 10MB — Apple Health bulk timeline JSON fits within this
)
DATA_UPLOAD_MAX_NUMBER_FIELDS = env.int("DATA_UPLOAD_MAX_NUMBER_FIELDS", default=1000)

# --- Session/CSRF Cookie Security ------------------------------------------------
# All environments get strict cookie security defaults; prod already sets SECURE.
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Strict"
CSRF_COOKIE_SAMESITE = "Strict"
CSRF_COOKIE_HTTPONLY = True

# --- CORS ---------------------------------------------------------------------
CORS_ALLOW_ALL_ORIGINS = env.bool("CORS_ALLOW_ALL_ORIGINS", default=True)
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])

# --- Celery -------------------------------------------------------------------
CELERY_BROKER_URL = env("CELERY_BROKER_URL", default="redis://localhost:6379/0")
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default="redis://localhost:6379/1")
CELERY_TASK_ALWAYS_EAGER = env.bool("CELERY_TASK_ALWAYS_EAGER", default=False)
CELERY_TASK_TRACK_STARTED = True
CELERY_BEAT_SCHEDULE = {
    "recover-stale-jobs": {
        "task": "apps.jobs.tasks.recover_stale_jobs_task",
        "schedule": 300.0,  # every 5 minutes
    },
    "cleanup-expired-shares": {
        "task": "apps.shares.tasks.cleanup_expired_shares_task",
        "schedule": 3600.0,  # every 1 hour
    },
    "purge-expired-soft-deletes": {
        "task": "apps.jobs.tasks.purge_expired_soft_deletes_task",
        "schedule": 86400.0,  # every 24 hours
    },
    "cleanup-expired-exports": {
        "task": "apps.accounts.export_tasks.cleanup_expired_exports_task",
        "schedule": 3600.0,  # every 1 hour
    },
}

# --- Email (Mailpit locally) --------------------------------------------------
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", default="localhost")
EMAIL_PORT = env.int("EMAIL_PORT", default=1025)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="RIVR <no-reply@rivrhealth.local>")

# --- OpenAI / AI models (worker phase) ----------------------------------------
OPENAI_API_KEY = env("OPENAI_API_KEY", default="")
OPENAI_BASE_URL = env("OPENAI_BASE_URL", default="https://api.openai.com/v1")
AI_MODEL_EXTRACT = env("AI_MODEL_EXTRACT", default="gpt-4o-2024-08-06")
AI_MODEL_EVAL = env("AI_MODEL_EVAL", default="gpt-4o-2024-08-06")
AI_MODEL_OCR = env("AI_MODEL_OCR", default="gpt-4o-mini")
AI_MODEL_TRANSCRIBE = env("AI_MODEL_TRANSCRIBE", default="whisper-1")
AI_MODEL_QUESTION_ANSWER = env("AI_MODEL_QUESTION_ANSWER", default="")

# --- AI cost control / DoS prevention -----------------------------------------
# Per-call output-token caps for the Responses API (param: max_output_tokens).
# Generous on purpose: legitimate structured output (full eval summary +
# recommendations + emergency card) must never truncate, since truncation breaks
# the JSON parse and the whole pipeline.
AI_EXTRACT_MAX_TOKENS = env.int("AI_EXTRACT_MAX_TOKENS", default=8000)
AI_EVAL_MAX_TOKENS = env.int("AI_EVAL_MAX_TOKENS", default=12000)
AI_QA_MAX_TOKENS = env.int("AI_QA_MAX_TOKENS", default=2000)
AI_OCR_MAX_TOKENS = env.int("AI_OCR_MAX_TOKENS", default=6000)
# Whisper transcript output is unbounded and feeds extraction; truncate very long
# transcripts (generous — a long voice note is well under this) to bound cost.
AI_TRANSCRIBE_MAX_CHARS = env.int("AI_TRANSCRIBE_MAX_CHARS", default=50000)

# --- Embeddings (Q&A vectorizing) --------------------------------------------
EMBEDDING_BASE_URL = env("EMBEDDING_BASE_URL", default=OPENAI_BASE_URL)
EMBEDDING_API_KEY = env("EMBEDDING_API_KEY", default=OPENAI_API_KEY)
EMBEDDING_MODEL = env("EMBEDDING_MODEL", default="nomic-embed-text-v1.5")
EMBEDDING_DIM = env.int("EMBEDDING_DIM", default=768)

# --- OCR ingestion -----------------------------------------------------------
OCR_MIN_IMAGE_PX = env.int("OCR_MIN_IMAGE_PX", default=100)
OCR_BATCH_SIZE = env.int("OCR_BATCH_SIZE", default=10)

# --- Frontend / share ---------------------------------------------------------
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:3000")
SHARE_PUBLIC_URL = env("SHARE_PUBLIC_URL", default="http://localhost:3000/share")

# --- Shares -------------------------------------------------------------------
SHARE_EXPIRES_MINUTES = env.int("SHARE_EXPIRES_MINUTES", default=1)
SHARE_MAX_VIEWS = env.int("SHARE_MAX_VIEWS", default=2)
SHARE_MAX_PIN_ATTEMPTS = env.int("SHARE_MAX_PIN_ATTEMPTS", default=5)
SHARE_CLEANUP_GRACE_HOURS = env.int("SHARE_CLEANUP_GRACE_HOURS", default=1)

# Trusted reverse-proxy IPs for X-Forwarded-For extraction.
# In production behind Caddy, set this to the Caddy container / VPS-internal IP.
# Empty list = no proxies trusted (REMOTE_ADDR is used directly).
TRUSTED_PROXIES = env.list("TRUSTED_PROXIES", default=[])

# --- Cache (required for DRF throttling) ----------------------------------------
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache"
        if DEBUG
        else "django.core.cache.backends.redis.RedisCache",
        "LOCATION": env("REDIS_URL", default="redis://localhost:6379/2")
        if not DEBUG
        else "rivr-throttle-cache",
    }
}
