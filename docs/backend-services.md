# Backend Services (Django / DRF / Celery)

This document is the exhaustive reference for the RIVR Health AI backend: the Django project layout, every app, its models and fields, serializers, and **every** REST endpoint, plus auth, permissions, storage, Celery wiring, and the admin.

It deliberately stops at the boundary of the deep AI pipeline. Anything about document fact-extraction, OCR, transcription, embeddings, the RAG Q&A internals, and the pydantic structured-output schemas lives in [AI Document Ingestion Pipeline & RAG Q&A](./ai-ingestion-and-qa.md). Where the orchestration here calls into those modules, this doc points at the call boundary and links across.

Related docs:

- [Documentation Index & System Overview](./README.md)
- [Architecture Overview](./architecture-overview.md)
- [AI Document Ingestion Pipeline & RAG Q&A](./ai-ingestion-and-qa.md)
- [Mobile App (Expo / React Native)](./mobile-app.md)
- [Web App (Next.js)](./web-app.md)
- [Data Model & End-to-End Flows](./data-model-and-flows.md)
- [Build, Deploy & Infrastructure](./build-deploy-infra.md)
- [Technology Stack Reference](./tech-stack.md)

> The backend lives under `backend/`. All paths in this document are relative to the repo root `/Users/darwashi/Downloads/rivr/RIVR-Health-AI` unless noted. Stack: Django 5.1.x, Django REST Framework, SimpleJWT, Celery, Postgres 16 + pgvector, Redis, S3/MinIO. The backend is a faithful Python port of a former Node/Supabase worker (docstrings repeatedly note "replaces …" / "port of worker/src/…").

---

## 1. Project structure

The Django **project package** is `config/` (not named after any app). The local applications live under the `apps/` namespace package.

```
backend/
├── manage.py                       # default DJANGO_SETTINGS_MODULE = config.settings.dev
├── config/                         # project package
│   ├── __init__.py                 # exposes celery_app (Celery autodiscovery at startup)
│   ├── celery.py                   # Celery("rivr"); autodiscover_tasks()
│   ├── urls.py                     # ROOT_URLCONF
│   ├── wsgi.py / asgi.py           # entry points
│   └── settings/
│       ├── __init__.py             # empty
│       ├── base.py                 # the real settings
│       ├── dev.py                  # from .base import *; DEBUG = True
│       └── test.py                 # eager Celery, in-memory storage, MD5 hasher, locmem email
├── apps/
│   ├── __init__.py                 # namespace package
│   ├── common/                     # reusable base models / viewsets / permissions / storage
│   ├── accounts/                   # custom User, JWT auth, signup, verify, reset, delete
│   ├── profiles/                   # UserProfile (demographics + medical), avatar, health-link
│   ├── documents/                  # Document model, upload, file download, CRUD
│   ├── jobs/                       # AiJob/AiJobEvent/Embedding, enqueue, Celery tasks, pipeline
│   ├── timeline/                   # TimelineEvent CRUD + bulk
│   ├── health/                     # HealthProfile / HealthEvaluation (read-only) + RAG Q&A
│   └── shares/                     # time/view-limited public share links → PDFs
├── requirements.txt / requirements-dev.txt
├── Dockerfile
├── docker-compose.yml
└── pytest.ini / conftest.py
```

Key project bindings (`config/urls.py`, `config/settings/base.py`):

| Binding | Value |
|---|---|
| `ROOT_URLCONF` | `config.urls` |
| `WSGI_APPLICATION` | `config.wsgi.application` |
| `ASGI_APPLICATION` | `config.asgi.application` |
| `AUTH_USER_MODEL` | `accounts.User` |
| `DEFAULT_AUTO_FIELD` | `django.db.models.BigAutoField` |
| Celery app | `Celery("rivr")`, exposed as `config.celery_app` |

### 1.1 Settings split (`config/settings/`)

- **`base.py`** — the real settings. Reads env via `django-environ` (`environ.Env`) and explicitly loads `BASE_DIR/.env` (`environ.Env.read_env(BASE_DIR / ".env")`) where `BASE_DIR = backend/`. So `backend/.env` is always read **in addition** to whatever Compose injects via `env_file`.
- **`dev.py`** — `from .base import *` then `DEBUG = True`.
- **`test.py`** — `from .base import *`, then `DEBUG=False`, `CELERY_TASK_ALWAYS_EAGER=True`, MD5 password hasher (fast), `EMAIL_BACKEND` → locmem, strips whitenoise from `MIDDLEWARE`, swaps `STORAGES["default"]` to `InMemoryStorage`, and raises the `share_resolve` throttle to `1000/min`. Tests still run against **real Postgres** because `ArrayField`/pgvector are Postgres-only.

> **Gotcha — no `config.settings.prod`.** Every entry point defaults `DJANGO_SETTINGS_MODULE` to `config.settings.dev` (`manage.py`, `config/wsgi.py`, `config/asgi.py`, `config/celery.py`). Production must override `DJANGO_SETTINGS_MODULE` in the environment, otherwise gunicorn inherits the wsgi default and runs with `DEBUG=True` and `CORS_ALLOW_ALL_ORIGINS` default-true. See [Build, Deploy & Infrastructure](./build-deploy-infra.md) for the deployment-config caveats.

### 1.2 INSTALLED_APPS (`config/settings/base.py:24`)

| Group | Apps |
|---|---|
| Django contrib | `admin`, `auth`, `contenttypes`, `sessions`, `messages`, `staticfiles` |
| Third-party | `rest_framework`, `rest_framework_simplejwt.token_blacklist`, `django_filters`, `corsheaders`, `drf_spectacular` |
| Local | `apps.common`, `apps.accounts`, `apps.profiles`, `apps.documents`, `apps.timeline`, `apps.health`, `apps.jobs`, `apps.shares` |

### 1.3 MIDDLEWARE (`config/settings/base.py:48`, ordered)

```
corsheaders.middleware.CorsMiddleware          # first — correct, lets CORS handle preflight
django.middleware.security.SecurityMiddleware
whitenoise.middleware.WhiteNoiseMiddleware     # static file serving
django.contrib.sessions.middleware.SessionMiddleware
django.middleware.common.CommonMiddleware
django.middleware.csrf.CsrfViewMiddleware
django.contrib.auth.middleware.AuthenticationMiddleware
django.contrib.messages.middleware.MessageMiddleware
django.middleware.clickjacking.XFrameOptionsMiddleware
```

### 1.4 DRF defaults (`REST_FRAMEWORK`, `config/settings/base.py:128`)

| Setting | Value |
|---|---|
| Authentication | `rest_framework_simplejwt.authentication.JWTAuthentication` |
| Permission (default) | `rest_framework.permissions.IsAuthenticated` (auth-by-default; `AllowAny` is opt-in per view) |
| Schema class | `drf_spectacular.openapi.AutoSchema` |
| Filter backends | `DjangoFilterBackend`, `OrderingFilter` |
| Pagination | `LimitOffsetPagination`, `PAGE_SIZE = 30` |
| Throttling | `ScopedRateThrottle`; rates `{"share_resolve": "30/min"}` (test: `1000/min`) |

`SPECTACULAR_SETTINGS`: `TITLE="RIVR API"`, `DESCRIPTION="RIVR Health backend API."`, `VERSION="0.1.0"`, `SERVE_INCLUDE_SCHEMA=False`. The OpenAPI schema is served at `/api/schema/` and Swagger UI at `/api/docs/`.

---

## 2. URL routing (`config/urls.py`)

```mermaid
graph TD
    Root["config.urls"] --> Admin["admin/ → Django admin"]
    Root --> Healthz["healthz → JsonResponse status:ok (no trailing slash)"]
    Root --> Schema["api/schema/ → SpectacularAPIView"]
    Root --> Docs["api/docs/ → SpectacularSwaggerView"]
    Root --> Auth["api/auth/ → apps.accounts.urls"]
    Root --> ApiPrefix["api/ → profiles, documents, timeline, health, jobs, shares"]
    Root --> DelAcct["api/account → DeleteAccountView (no trailing slash)"]
```

| Path | Target | Notes |
|---|---|---|
| `admin/` | Django admin site | |
| `healthz` | inline `JsonResponse({"status": "ok"})` | name `healthz`, **no trailing slash** |
| `api/schema/` | `SpectacularAPIView` | name `schema` |
| `api/docs/` | `SpectacularSwaggerView(url_name="schema")` | name `docs` |
| `api/auth/` | `include("apps.accounts.urls")` | |
| `api/` | `include` of profiles, documents, timeline, health, jobs, shares | |
| `api/account` | `apps.accounts.account_views.DeleteAccountView` | name `delete-account`, **no trailing slash**, mounted directly in `config/urls.py` (not in the accounts app `urls.py`) |

> **Trailing-slash convention is inconsistent.** Auth + profile + the single-path endpoints (`register`, `login`, `me`, `profile`, `health-profile`, `qa`, `shares`, `account`) have **no** trailing slash. Router-registered viewsets (`documents/`, `ai-jobs/`, `timeline-events/`, `health-evaluations/`) **do** — DRF's `SimpleRouter` generates `prefix/` and `prefix/{pk}/`. Clients must match each group's convention (DRF `APPEND_SLASH`). The mobile/web clients hard-code these exact paths.

---

## 3. Authentication & authorization

### 3.1 JWT (SimpleJWT)

DRF default auth is `JWTAuthentication`; default permission is `IsAuthenticated`. SimpleJWT config (`config/settings/base.py:153`):

| Setting | Value | Meaning |
|---|---|---|
| `ACCESS_TOKEN_LIFETIME` | `timedelta(minutes=30)` | short-lived access token |
| `REFRESH_TOKEN_LIFETIME` | `timedelta(days=30)` | refresh good for 30 days |
| `ROTATE_REFRESH_TOKENS` | `True` | each refresh issues a **new** refresh token |
| `BLACKLIST_AFTER_ROTATION` | `True` | the old refresh is blacklisted on rotation |

`rest_framework_simplejwt.token_blacklist` is installed — required for logout blacklisting and `BLACKLIST_AFTER_ROTATION`.

```mermaid
sequenceDiagram
    participant C as Client
    participant API as DRF/SimpleJWT
    C->>API: POST /api/auth/login {email, password}
    API-->>C: {access (30m), refresh (30d), user}
    Note over C: stores both tokens
    C->>API: GET /api/... (Authorization: Bearer <access>)
    API-->>C: 200 (or 401 when access expired)
    C->>API: POST /api/auth/token/refresh {refresh}
    API-->>C: {access, refresh}  // old refresh blacklisted (rotation)
    C->>API: POST /api/auth/logout {refresh}
    API-->>C: 205  // refresh blacklisted; access still valid until expiry
```

### 3.2 Token mechanics for email links (`apps/accounts/tokens.py`)

Two **separate** stateless token mechanisms — neither is a JWT:

| Use | Mechanism | Details |
|---|---|---|
| Email verification | `django.core.signing` | salt `accounts.email-verify`, `EMAIL_VERIFY_MAX_AGE = 60*60*24*7` (7 days). `make_email_verify_token(user)` = `signing.dumps(str(user.pk), salt=…)`; `read_email_verify_token(token)` = `signing.loads(…, max_age=…)` returning the user or `None` (catches `BadSignature`, which `SignatureExpired` subclasses). |
| Password reset | Django `default_token_generator` + base64 uid | `make_password_reset_tokens(user)` → `(urlsafe_base64_encode(force_bytes(user.pk)), default_token_generator.make_token(user))`; `read_password_reset(uid, token)` decodes the uid, fetches the user, validates with `check_token`. The reset token is auto-invalidated by a password change or `last_login` change (standard Django behavior). |

### 3.3 Permissions (`apps/common/permissions.py`)

`IsOwner(BasePermission)` is an object-level check: it reads `owner_field` from the **view** first (falling back to `"user"`), then compares `getattr(obj, f"{owner_field}_id") == request.user.id`. It is defence-in-depth on top of the queryset scoping done by the owned viewsets (see §4.2).

### 3.4 Email sending (`apps/accounts/emails.py`)

Uses `django.core.mail.send_mail` (plain-text only, no HTML templates). `_safe_send(...)` wraps `send_mail` in try/except and logs failures via `logger.exception` — **mail is fail-silent**, so register/forgot endpoints succeed even if SMTP is down.

- `send_verification_email(user)` → link `{FRONTEND_URL}/verify-email?token={token}`, subject "Verify your RIVR email".
- `send_password_reset_email(user)` → link `{FRONTEND_URL}/reset-password?uid={uid}&token={token}`, subject "Reset your RIVR password".

The links target the [Next.js web app](./web-app.md) (`FRONTEND_URL`), which posts the token back to the API.

---

## 4. App: `apps.common` (reusable bases)

This app holds the abstract bases and shared infrastructure used by every other app. Label `common`.

### 4.1 Abstract models (`apps/common/models.py`)

| Class | Fields | Notes |
|---|---|---|
| `UUIDModel` | `id = UUIDField(primary_key=True, default=uuid.uuid4, editable=False)` | UUID PK matching the legacy `gen_random_uuid()` pks. abstract |
| `TimeStampedModel` | `created_at` (`auto_now_add`), `updated_at` (`auto_now`) | abstract |
| `BaseModel` | = `UUIDModel` + `TimeStampedModel` | the common base for most concrete models. abstract |

### 4.2 Viewsets (`apps/common/viewsets.py`)

- **`OwnedModelViewSet(ModelViewSet)`** — `owner_field = "user"`, `permission_classes = [IsAuthenticated, IsOwner]`. `get_queryset()` filters `super().get_queryset().filter(**{owner_field: request.user})` so **other users' rows are invisible (404, not a 403 existence leak)**. `perform_create` stamps `serializer.save(**{owner_field: request.user})`.
- **`ReadOnlyOwnedViewSet(OwnedModelViewSet)`** — `http_method_names = ["get", "head", "options"]`.

### 4.3 Object storage helpers (`apps/common/storage.py`)

A single-bucket, prefix-based layout over Django's `default_storage`. The backend is chosen in settings: `FileSystemStorage` by default; `storages.backends.s3.S3Storage` when `AWS_ACCESS_KEY_ID` is set; `InMemoryStorage` in tests.

| Helper | Behavior |
|---|---|
| `document_kind(content_type, source_type)` | `"voice-notes"` (audio / `source_type=voice_note`), `"medical-images"` (image / `source_type=image`), else `"medical-documents"`. |
| `document_key(user_id, filename, kind)` | `documents/{user_id}/{kind}/{uuid4hex}_{safe}` (slashes in filename → `_`). |
| `avatar_key(user_id)` | `avatars/{user_id}/avatar.jpg` (fixed name → one avatar per user, overwritten). |
| `sha256_of(file_obj)` | hex sha256, seeks back to 0. |
| `save(key, file_obj)` | `default_storage.save` (returns the actually-stored key). |
| `delete(key)` | deletes if key truthy and exists. |
| `delete_prefix(prefix)` | recursive best-effort `listdir` + delete; swallows `NotImplementedError`/`FileNotFoundError`. |
| `signed_url(key, expire=600)` | `default_storage.url(key, expire=expire)`; falls back to `default_storage.url(key)` on `TypeError` (FileSystemStorage's `url` rejects `expire`). Returns `None` for empty key. |
| `process_avatar(uploaded_file)` | Pillow: open → `convert("RGB")` → center-crop to largest square → resize 512×512 → re-encode JPEG quality 85 into `ContentFile(name="avatar.jpg")` (strips EXIF/metadata). |

**Storage key layout** (single bucket, domain-prefixed):

```
documents/{user_id}/{kind}/{uuid4hex}_{name}            # uploaded blobs
documents/{user_id}/processed/{doc_id}/summary.json     # per-doc extracted facts (pipeline)
documents/{user_id}/ai/evaluation/latest.json           # latest evaluation mirror (pipeline)
avatars/{user_id}/avatar.jpg                             # processed avatar
share-artifacts/{uuid4hex}/{share_type}.pdf             # generated share PDFs
```

> **MinIO file-URL caveat:** there is no `AWS_S3_CUSTOM_DOMAIN`/URL override. When S3/MinIO is active, signed URLs point at the configured `AWS_S3_ENDPOINT_URL` (e.g. the internal `http://minio:9000`), which is not reachable from a device or host browser. See [Build, Deploy & Infrastructure](./build-deploy-infra.md).

---

## 5. App: `apps.accounts`

Custom user, JWT login/refresh/logout, signup, email verification, password reset/change, account deletion. Label `accounts`. Docstrings note these tables "replace" the old Supabase `auth.users`.

### 5.1 Model — `User` (`apps/accounts/models.py`, `db_table="users"`)

`class User(AbstractBaseUser, PermissionsMixin)`.

| Field | Type | Notes |
|---|---|---|
| `id` | `UUIDField(primary_key=True, default=uuid.uuid4, editable=False)` | UUID PK, not int |
| `email` | `EmailField(unique=True)` | `USERNAME_FIELD` |
| `is_active` | `BooleanField(default=True)` | |
| `is_staff` | `BooleanField(default=False)` | |
| `email_verified_at` | `DateTimeField(null=True, blank=True)` | timestamp, **not** a boolean |
| `date_joined` | `DateTimeField(default=timezone.now)` | |
| inherited | `password`, `last_login`, `is_superuser`, `groups`, `user_permissions` | from `AbstractBaseUser` / `PermissionsMixin` |

- `objects = UserManager()`; `USERNAME_FIELD = "email"`; `REQUIRED_FIELDS = []` (so `createsuperuser` prompts only email + password).
- `Meta.ordering = ["-date_joined"]`.
- `@property is_email_verified` → `email_verified_at is not None`.
- **No `first_name`/`last_name`/`username` on `User`** — name fields live on `UserProfile`.

**Manager** (`apps/accounts/managers.py`) — `UserManager(BaseUserManager)`, `use_in_migrations=True`. `_create_user` raises `ValueError("Users must have an email address.")` when no email, normalizes the email, hashes the password. `create_user` defaults `is_staff=False, is_superuser=False`; `create_superuser` forces both `True` (raises if not).

### 5.2 Serializers (`apps/accounts/serializers.py`)

| Serializer | Shape |
|---|---|
| `UserSerializer(ModelSerializer)` | `fields=["id","email","is_email_verified","date_joined"]`, all read-only. `is_email_verified` is an explicit `BooleanField(read_only=True)` mapping to the model property. The safe public user representation. |
| `RegisterSerializer(Serializer)` | `email=EmailField()`, `password=CharField(write_only=True, validators=[validate_password])`. `validate_email` lowercases/strips and rejects duplicates (`email__iexact`). `create()` → `User.objects.create_user(...)`. |
| `LoginSerializer(TokenObtainPairSerializer)` | extends SimpleJWT's pair serializer; `validate()` injects `data["user"] = UserSerializer(self.user).data`. Login returns `{access, refresh, user}`. |
| `EmailVerifySerializer` | `token=CharField()` |
| `PasswordForgotSerializer` | `email=EmailField()` |
| `PasswordResetSerializer` | `uid=CharField()`, `token=CharField()`, `password=CharField(validators=[validate_password])` |
| `PasswordChangeSerializer` | `current_password`, `new_password` (validated). `validate_current_password` checks `request.user.check_password(value)`. |
| `LogoutSerializer` | `refresh=CharField()` |

### 5.3 Views (`apps/accounts/views.py`, `apps/accounts/account_views.py`)

Helper `_tokens_for(user)` → `{"refresh": str(refresh), "access": str(refresh.access_token)}` via `RefreshToken.for_user(user)`.

| View | Permission | Behavior |
|---|---|---|
| `RegisterView(APIView)` | `AllowAny` | `POST`: validate + `create_user`, `send_verification_email(user)`, return `{user, access, refresh}` **201**. JWTs are returned immediately — no email-verification gate on login. |
| `LoginView(TokenObtainPairView)` | `AllowAny` | `serializer_class = LoginSerializer`. |
| `MeView(APIView)` | `IsAuthenticated` | `GET` → `UserSerializer(request.user).data`. |
| `LogoutView(APIView)` | `IsAuthenticated` | `POST`: `RefreshToken(refresh).blacklist()`. `TokenError` → 400 `{"detail":"Invalid token."}`; success → **205** (RESET_CONTENT). |
| `VerifyEmailView(APIView)` | `AllowAny` | `POST`: `read_email_verify_token(token)`; `None` → 400; else sets `email_verified_at = now()` once (idempotent). |
| `PasswordForgotView(APIView)` | `AllowAny` | `POST`: lookup `email__iexact`, send reset email if found. **Always 200** "If that email exists, a reset link has been sent." (enumeration protection). |
| `PasswordResetView(APIView)` | `AllowAny` | `POST`: `read_password_reset(uid, token)`; `None` → 400; else `set_password` + save. |
| `PasswordChangeView(APIView)` | `IsAuthenticated` | `POST`: validate current password, then `set_password(new_password)` + save. |
| `DeleteAccountView(APIView)` | `IsAuthenticated` | `DELETE`: best-effort `storage.delete_prefix("documents/{id}")` + `delete_prefix("avatars/{id}")`, then `user.delete()` (cascades remove owned rows incl. `UserProfile`). **204**. |

### 5.4 Endpoints — accounts

Mounted at `api/auth/` (from `apps/accounts/urls.py`) except delete (mounted at `api/account` in `config/urls.py`).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | AllowAny | Create user, send verification email, return `{user, access, refresh}` (201). |
| POST | `/api/auth/login` | AllowAny | Validate email+password → `{access, refresh, user}`. |
| POST | `/api/auth/token/refresh` | AllowAny | SimpleJWT `TokenRefreshView` — rotate access **and** refresh; blacklist old refresh. |
| POST | `/api/auth/logout` | IsAuthenticated | Blacklist supplied `refresh`; 205 on success, 400 on invalid. |
| GET | `/api/auth/me` | IsAuthenticated | Current user (`UserSerializer`). |
| POST | `/api/auth/verify-email` | AllowAny | Consume signed `token`, set `email_verified_at`. |
| POST | `/api/auth/password/forgot` | AllowAny | Send reset email if email exists; always 200 (no enumeration). |
| POST | `/api/auth/password/reset` | AllowAny | `{uid, token, password}` → set new password. |
| POST | `/api/auth/password/change` | IsAuthenticated | `{current_password, new_password}` → change own password. |
| DELETE | `/api/account` | IsAuthenticated | Delete current user + their storage objects (`documents/{id}`, `avatars/{id}`); 204. |

> **Gotchas:** (1) Email verification is **informational only** — `email_verified_at` is never enforced for login/API access. (2) `register` reveals duplicate emails ("A user with this email already exists."); only `password/forgot` is enumeration-protected. (3) **Password change/reset does not invalidate issued JWTs** — refresh tokens stay valid up to 30 days; access tokens up to 30 minutes. (4) Logout returns **205**, not 204/200. (5) The mobile client also calls a path `POST /api/account/delete/` in `ProfileScreen`; the canonical server route is `DELETE /api/account` — see [Mobile App](./mobile-app.md).

### 5.5 Admin (`apps/accounts/admin.py`)

`UserAdmin(DjangoUserAdmin)` for `User`: `list_display=["email","is_active","is_staff","email_verified_at","date_joined"]`, `search_fields=["email"]`, `readonly_fields=["id","date_joined","last_login"]`, custom `fieldsets`/`add_fieldsets` (email + password1/password2), `ordering=["-date_joined"]`.

---

## 6. App: `apps.profiles`

Per-user demographic + medical profile, avatar upload, and the Apple-Health link flag. Label `profiles`.

### 6.1 Model — `UserProfile` (`apps/profiles/models.py`, `db_table="user_profiles"`)

`class UserProfile(BaseModel)` → UUID PK + `created_at`/`updated_at`.

| Group | Fields |
|---|---|
| Relation | `user` — `OneToOneField("accounts.User", on_delete=CASCADE, related_name="profile")` (access via `user.profile`) |
| Demographics | `first_name` C(255), `last_name` C(255), `date_of_birth` Date(null), `sex_or_gender` C(64), `occupation` C(255), `marital_status` C(64), `number_of_children` Int(null) |
| Contact / emergency | `email` EmailField (profile-level, **separate** from `User.email`, not auto-synced), `mobile_phone` C(64), `emergency_contact_name` C(255), `emergency_contact_phone` C(64), `emergency_contact_relationship` C(128) |
| Lifestyle / symptoms | `smoking_status` C(64), `alcohol_use` C(64), `exercise_level` C(64), `current_symptoms` TextField |
| Medical JSON lists (`JSONField(default=list, blank=True)`) | `allergies`, `medications`, `medical_history`, `surgical_history`, `family_history`, `hospitalizations`, `social_history` — arrays of dict items; AI-backfilled items are prefixed `ai_` and tracked in `ai_backfill_meta` |
| Other JSON | `story_answers` JSON(null), `ai_backfill_meta` JSON(null) |
| Timestamps / metadata | `onboarding_completed_at` DateTime(null), `health_linked_at` DateTime(null) (Apple-Health link timestamp), `avatar_path` C(1024, default="") (storage **key**, not a URL) |

`@classmethod for_user(cls, user)` → `get_or_create(user=user)`. This is the single entry point used by every profile/avatar/health-link view, so a `user_profiles` row may not exist until first GET/PUT/avatar/link call (no signal creates it at registration).

The seven medical JSON lists are written/read by the user and back-filled by the AI pipeline; see how `ai_backfill_meta` provenance and `ai_`-prefixed items work in [AI Document Ingestion Pipeline & RAG Q&A](./ai-ingestion-and-qa.md).

### 6.2 Serializer (`apps/profiles/serializers.py`)

`UserProfileSerializer(ModelSerializer)` — `exclude=["user"]` (every other field exposed, including all medical JSON arrays, `ai_backfill_meta`, `story_answers`, timestamps), `read_only_fields=["id","created_at","updated_at"]`.

> **`null → ""` coercion:** clients send `null` to clear optional text fields, but those map to `CharField(blank=True, null=False)` which DRF rejects. `to_internal_value` coerces `null → ""` for any `CharField` where `not allow_null`. Other field types (Date/Integer/JSON) keep `null`.

### 6.3 Views (`apps/profiles/views.py`, `apps/profiles/avatar_views.py`)

| View | Permission | Behavior |
|---|---|---|
| `MyProfileView(RetrieveUpdateAPIView)` | IsAuthenticated | `get_object()` → `UserProfile.for_user(request.user)`. GET / PUT / PATCH on the caller's own profile (auto-created). |
| `LinkHealthView(_HealthLinkBase)` | IsAuthenticated | `linked=True`: `POST` sets `health_linked_at = now()`, returns `{health_linked_at}`. |
| `UnlinkHealthView(_HealthLinkBase)` | IsAuthenticated | `linked=False`: `POST` sets `health_linked_at = None`. |
| `AvatarView(APIView)` | IsAuthenticated, `MultiPartParser`/`FormParser` | GET → `{avatar_path, url}` (signed URL or None). POST → reads `image`/`file` (400 if absent), deletes old avatar, saves `process_avatar(upload)` under `avatars/{id}/avatar.jpg`, stores path; **201**. DELETE → delete object, clear `avatar_path`; **204**. |

### 6.4 Endpoints — profiles

Mounted at `api/` (from `apps/profiles/urls.py`).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET / PUT / PATCH | `/api/profile` | IsAuthenticated | Read/update own `UserProfile` (auto-created). |
| POST | `/api/profile/link-health` | IsAuthenticated | Set `health_linked_at = now()`. |
| POST | `/api/profile/unlink-health` | IsAuthenticated | Set `health_linked_at = None`. |
| GET | `/api/profile/avatar` | IsAuthenticated | `{avatar_path, url}` (signed URL). |
| POST | `/api/profile/avatar` | IsAuthenticated | Multipart `image`/`file` → 512×512 JPEG, store, save path; 201. |
| DELETE | `/api/profile/avatar` | IsAuthenticated | Delete avatar object, clear `avatar_path`; 204. |

### 6.5 Admin (`apps/profiles/admin.py`)

`UserProfileAdmin`: `list_display=["user","first_name","last_name","onboarding_completed_at"]`, `search_fields=["user__email","first_name","last_name"]`, `raw_id_fields=["user"]`.

---

## 7. App: `apps.documents`

Owns the `Document` model (user-uploaded medical files + the special per-user `manual_input` document), the upload endpoint, file download (signed URL), and owner-scoped CRUD. Label `documents`. **Upload does not start processing** — enqueuing a job is a separate explicit call (see §8).

### 7.1 Model — `Document` (`apps/documents/models.py`, `db_table="documents"`)

`class Document(BaseModel)` → UUID PK + timestamps.

| Field | Type | Notes |
|---|---|---|
| `user` | FK `accounts.User`, CASCADE, `related_name="documents"` | |
| `title` | CharField(512, blank, default="") | |
| `status` | CharField(20), choices `Status` | `UPLOADED`/`PROCESSING`/`PROCESSED`/`FAILED`; default `uploaded` |
| `source_type` | CharField(20), choices `SourceType` | `FILE`/`PDF`/`SCANNED_PDF`/`VOICE_NOTE`/`MANUAL_INPUT`/`IMAGE`; default `file` |
| `pdf_path` | CharField(1024) | storage key of the uploaded blob — used for **any** file type (audio/images too), despite the name |
| `summary_path` | CharField(1024) | storage key of per-doc extracted facts JSON, written by the pipeline at `documents/{user}/processed/{doc}/summary.json` |
| `mime_type` | CharField(255) | |
| `size_bytes` | BigIntegerField(null) | |
| `sha256` | CharField(64) | hex sha256 of the upload |
| `processing_error` | TextField | |
| `processed_at` | DateTimeField(null) | |
| `content_json` | JSONField(null) | present in schema; not written by upload or pipeline (reserved/legacy; the mobile manual-input flow writes a snapshot here) |

`Status` values: `uploaded`, `processing`, `processed`, `failed`. `SourceType` values: `file`, `pdf`, `scanned_pdf`, `voice_note`, `manual_input`, `image`.

`Meta`: `ordering=["-created_at"]`; **constraint** `uniq_manual_input_doc_per_user` = `UniqueConstraint(fields=["user"], condition=Q(source_type="manual_input"))` → at most one manual-input doc per user.

Migrations: `0001_initial`, `0002_remove_document_fhir_path` (drops a legacy `fhir_path` field).

### 7.2 Serializer & filter

- `DocumentSerializer(ModelSerializer)` — `exclude=["user"]`, `read_only_fields=["id","created_at","updated_at","processed_at"]`. Other model fields are writable through the serializer, but rows are created via the `upload` action which builds the model directly.
- `DocumentFilter(FilterSet)` (`Meta.fields=[]`, all explicit): `status` (iexact), `title` (iexact), `status__in` (BaseInFilter), `exclude_status` (CharFilter `status` exclude), `source_type` (iexact), `has_processed_at` (BooleanFilter on `processed_at__isnull` exclude → `true` means "has a value").

### 7.3 View — `DocumentViewSet(OwnedModelViewSet)` (`apps/documents/views.py`)

`queryset = Document.objects.all()` (auto-scoped to the owner), `filterset_class = DocumentFilter`, `ordering_fields = ["created_at","processed_at"]`, default `-created_at`.

- `perform_destroy(instance)` overridden — `storage.delete(instance.pdf_path)` then `super().perform_destroy()`. DB cascades: `TimelineEvent.document` is `SET_NULL` (events survive), `Embedding.document` is CASCADE (embeddings deleted). The per-doc `summary.json`/evaluation JSON in storage is **not** cleaned up on doc delete (only `pdf_path`).
- `upload` (`@action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])`) — the primary ingest endpoint:
  1. `request.FILES.get("file")` → 400 `{"detail":"No file provided."}` if absent.
  2. `source_type = request.data.get("source_type", SourceType.FILE)`.
  3. `kind = storage.document_kind(content_type, source_type)`; `key = storage.document_key(user.id, name, kind)`; `saved = storage.save(key, upload)`.
  4. `Document.objects.create(title=request.data.get("title","") or upload.name, status=UPLOADED, pdf_path=saved, mime_type=…, size_bytes=upload.size, sha256=storage.sha256_of(upload))`.
  5. Returns `DocumentSerializer(doc).data` (**201**). **Does NOT enqueue any job.**
- `file` (`@action(detail=True, methods=["get"])`) — returns `{"url": storage.signed_url(doc.pdf_path)}`.

### 7.4 Endpoints — documents

Router base `documents`, mounted at `api/`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/documents/` | IsAuthenticated | List (owner-scoped, paginated, filterable, orderable). |
| POST | `/api/documents/` | IsAuthenticated | Standard create (rarely used; `upload` is the real entry). |
| GET | `/api/documents/{pk}/` | IsAuthenticated | Retrieve. |
| PUT / PATCH | `/api/documents/{pk}/` | IsAuthenticated | Update. |
| DELETE | `/api/documents/{pk}/` | IsAuthenticated | Destroy — deletes the blob, then the row (cascades). |
| POST | `/api/documents/upload/` | IsAuthenticated | Primary ingest: multipart `file` (+ `source_type`, `title`) → `UPLOADED` Document. **No enqueue.** |
| GET | `/api/documents/{pk}/file/` | IsAuthenticated | `{"url": <signed URL>}` (600s on S3, null if no path). |

### 7.5 Admin (`apps/documents/admin.py`)

`DocumentAdmin`: `list_display=[id, user, title, status, source_type, created_at]`, `list_filter=[status, source_type]`, search `title` + `user__email`, `raw_id_fields=[user]`.

---

## 8. App: `apps.jobs` (async orchestration)

The async job system that wraps the AI document-processing & profile-evaluation pipeline. It owns the `AiJob`/`AiJobEvent` records, the `Embedding` pgvector table, the enqueue service, three Celery task entrypoints, the orchestration driver (`pipeline.run_job`), the stale-job recovery beat task, the read/cancel/enqueue endpoints, and a backfill management command. Label `jobs`.

> This section covers the **non-AI orchestration**. The pipeline's actual AI work (`extraction.py`, `ai_client.py`, `embeddings.py`, `index.py`, `profile_logic.py`, `schemas.py`, the per-doc/eval stages) is documented in [AI Document Ingestion Pipeline & RAG Q&A](./ai-ingestion-and-qa.md). Call boundaries are noted below.

### 8.1 Models (`apps/jobs/models.py`)

**`AiJob(BaseModel)`** — `db_table="ai_jobs"`:

| Field | Type | Notes |
|---|---|---|
| `user` | FK `accounts.User`, CASCADE, `related_name="ai_jobs"` | |
| `job_type` | CharField(32), choices `JobType` | `process_documents` / `profile_evaluation` |
| `document_ids` | `ArrayField(UUIDField, default=list)` | Postgres array |
| `status` | CharField(16), choices `Status` | `queued`/`running`/`succeeded`/`failed`/`cancelled`; default `queued` |
| `priority` | Int(default=100) | vestigial (legacy DB-polling worker) |
| `attempts` | Int(default=0) | vestigial |
| `locked_at` | DateTime(null) | vestigial (no lock is acquired under Celery) |
| `locked_by` | CharField(255) | vestigial |
| `stage` | CharField(128) | human-readable progress stage (e.g. `downloading_file`, `extracting_text`, `openai_extract`, `openai_eval`, `saving_profile`) |
| `heartbeat_at` | DateTime(null) | bumped by `_set_stage` |
| `progress` | JSONField(default=dict) | e.g. `{"total","done","currentDocId"}` |
| `error` | TextField | |
| `result` | JSONField(null) | on success `{"health_profile_updated": True, "evaluation_id": …}` |
| `cancel_requested` | Bool(default=False) | flipped by the cancel endpoint |
| `cancelled_at` | DateTime(null) | |

`Meta`: `ordering=["-created_at"]`; index on `["user","status"]`.

**`AiJobEvent`** (plain `models.Model`, BigAutoField PK) — `db_table="ai_job_events"`: `job` FK CASCADE `related_name="events"`, `at` (`auto_now_add`), `level` (`debug`/`info`/`warn`/`error`, default `info`), `message` TextField, `data` JSON(null). `Meta.ordering=["at"]`. Append-only structured log written by `pipeline._log`.

**`Embedding(BaseModel)`** — `db_table="embeddings"`, the Q&A vector index: `user` FK CASCADE, `document` FK `documents.Document` CASCADE null/blank, `kind` (`doc_chunk`/`fact`/`timeline`), `ref` CharField(64), `content` TextField, `vector = VectorField(dimensions=768)`. Indexes: `HnswIndex(name="emb_vec_hnsw", fields=["vector"], m=16, ef_construction=64, opclasses=["vector_cosine_ops"])` + `Index(["user"])`. (The vector population/query is AI-pipeline territory — see the linked doc.)

Migrations: `0001_initial` (AiJob+AiJobEvent), `0002_alter_aijob_status` (removed an early `"processing"` job status — final job statuses are `queued`/`running`/`succeeded`/`failed`/`cancelled`; `processing` is a **Document** status only), `0003_vector_extension` (`pgvector.django.VectorExtension()` — installs the Postgres `vector` extension), `0004_embedding`.

### 8.2 Enqueue service (`apps/jobs/services.py`)

`_ACTIVE = [QUEUED, RUNNING]`; `_active(user, job_type)` filters jobs in those statuses.

- **`enqueue_processing(user, document_ids) -> (AiJob | None, reused)`** (`@transaction.atomic`):
  - Loads the user's docs in `document_ids`, **excluding** `source_type=MANUAL_INPUT`.
  - If none processable → `(None, False)`.
  - Dedupe: finds an active `PROCESS_DOCUMENTS` job whose `document_ids__overlap=doc_ids` (Postgres array overlap) → `(existing, True)`.
  - Else creates `AiJob(job_type=PROCESS_DOCUMENTS, document_ids=doc_ids)` **and** flips those docs `status=PROCESSING` (bulk) → `(job, False)`.
- **`enqueue_profile_evaluation(user) -> (AiJob, reused)`** (`@transaction.atomic`):
  - Reuses any active `PROFILE_EVALUATION` job; else creates one with empty `document_ids`. No documents transition here.

### 8.3 Enqueue view (`apps/jobs/views.py`)

`EnqueueView(APIView)` (`IsAuthenticated`), `POST`:

- Reads `jobType`/`job_type`. If `profile_evaluation` → `enqueue_profile_evaluation(user)`, task = `PROFILE_TASK`. Else resolves ids from `documentIds`/`document_ids`/`[documentId]` → `enqueue_processing(user, ids)`, task = `PROCESS_TASK`.
- `job is None` → 400 `{"detail":"No processable documents."}`.
- Not reused → `transaction.on_commit(lambda: celery_app.send_task(task, args=[str(job.id)]))` — the task is dispatched **only after the DB transaction commits**, so the worker never races ahead of the committed job/doc rows. Reused jobs are **not** re-dispatched.
- Returns **202** `{"jobId": str, "reused": bool}`.

Task name constants (used by `celery_app.send_task`, decoupled from imports):

```python
PROCESS_TASK = "apps.jobs.tasks.process_documents_task"
PROFILE_TASK = "apps.jobs.tasks.profile_evaluation_task"
```

### 8.4 Upload → job flow

```mermaid
sequenceDiagram
    participant C as Client
    participant Doc as DocumentViewSet.upload
    participant Enq as EnqueueView
    participant Svc as services.enqueue_processing
    participant Cel as Celery (Redis broker)
    participant W as Worker (pipeline.run_job)

    C->>Doc: POST /api/documents/upload/ (multipart file)
    Doc->>Doc: storage.save + Document(status=UPLOADED)
    Doc-->>C: 201 {id, status:uploaded}
    Note over C,Doc: NO automatic enqueue — separate call required
    C->>Enq: POST /api/jobs/enqueue {documentIds:[id]}
    Enq->>Svc: enqueue_processing(user, ids)
    Svc->>Svc: dedupe (overlap) OR create AiJob + docs→PROCESSING
    Enq->>Cel: transaction.on_commit → send_task(PROCESS_TASK, [job_id])
    Enq-->>C: 202 {jobId, reused}
    Cel->>W: process_documents_task(job_id) → pipeline.run_job(job_id)
```

### 8.5 Celery tasks (`apps/jobs/tasks.py`)

All `@shared_task` with explicit `name=`:

| Task | Name | Delegates to |
|---|---|---|
| `process_documents_task(job_id)` | `apps.jobs.tasks.process_documents_task` | `pipeline.run_job(job_id)` |
| `profile_evaluation_task(job_id)` | `apps.jobs.tasks.profile_evaluation_task` | `pipeline.run_job(job_id)` (same driver; branch decided by `job.job_type`) |
| `recover_stale_jobs_task()` | `apps.jobs.tasks.recover_stale_jobs_task` | `pipeline.recover_stale_jobs()`; returns count |

### 8.6 Celery configuration (`config/celery.py`, `config/settings/base.py`)

- `app = Celery("rivr")`, `config_from_object("django.conf:settings", namespace="CELERY")`, `autodiscover_tasks()`. Exposed as `config.celery_app` (imported in `config/__init__.py` so `@shared_task` autodiscovery works at startup).
- `CELERY_BROKER_URL` default `redis://localhost:6379/0` (DB 0 = broker), `CELERY_RESULT_BACKEND` default `redis://localhost:6379/1` (DB 1 = results).
- `CELERY_TASK_ALWAYS_EAGER` (default False; **True in tests**), `CELERY_TASK_TRACK_STARTED=True`.
- **Beat schedule** — one entry:

```python
CELERY_BEAT_SCHEDULE = {
    "recover-stale-jobs": {
        "task": "apps.jobs.tasks.recover_stale_jobs_task",
        "schedule": 300.0,  # every 5 minutes
    },
}
```

Run commands (Compose): worker = `celery -A config worker -l info`; beat = `celery -A config beat -l info`. See [Build, Deploy & Infrastructure](./build-deploy-infra.md).

### 8.7 Job lifecycle (`pipeline.py` orchestration view)

```mermaid
stateDiagram-v2
    [*] --> queued: enqueue_*
    queued --> running: run_job sets status RUNNING
    running --> succeeded: _common_tail OK (docs PROCESSING→PROCESSED)
    running --> failed: Exception → _fail + re-raise (docs PROCESSING→UPLOADED via recovery)
    running --> cancelled: cancel_requested seen at checkpoint → _cancel (docs PROCESSING→UPLOADED)
    running --> failed: stale (RUNNING > 30 min) → recover_stale_jobs
```

- `run_job(job_id)` is **idempotent** for already-terminal jobs (re-delivery safe). It loads the job; if missing or already SUCCEEDED/CANCELLED, returns. Otherwise sets `status=RUNNING` and branches on `job_type`. (The actual per-document and evaluation work is AI-pipeline territory — see the linked doc.)
- Terminal transitions: `_fail(job, message)` (status FAILED, `error`, clears lock fields, logs error, then **re-raises** so Celery records the failure); `_cancel(job)` (status CANCELLED, `cancelled_at=now`, reverts still-PROCESSING docs to UPLOADED; does **not** re-raise); success (status SUCCEEDED, `result` set, PROCESSING docs flipped to PROCESSED).
- **Cooperative cancellation:** `_check_cancelled(job)` re-reads `cancel_requested`/`status` from the DB at many checkpoints and raises `CancellationError`. The cancel endpoint only flips the flag; work continues until the next checkpoint.
- **Stale recovery** (`recover_stale_jobs`, run from beat every 5 min): marks `RUNNING` jobs whose `updated_at` is older than **30 minutes** as `FAILED` (`"Job timed out - worker may have crashed. You can retry."`), clears lock fields, reverts their PROCESSING docs to UPLOADED. Returns the count.

### 8.8 Read/cancel viewset & endpoints

`AiJobViewSet(ReadOnlyOwnedViewSet)` — `queryset = AiJob.objects.all()` (owner-scoped), `filterset_class=AiJobFilter`, `ordering=["-created_at"]`, `http_method_names=["get","head","options","post"]` (the extra `post` is for the cancel action). `cancel` (`@action(detail=True, methods=["post"])`) sets `cancel_requested=True` only if status in `QUEUED`/`RUNNING`, then returns the serialized job.

`AiJobSerializer` — `exclude=["user"]`; every field except `id` is read-only (`read_only_fields = [f.name for f in AiJob._meta.fields if f.name != "id"]`).

`AiJobFilter` (`Meta.fields=[]`): `status` (iexact), `status__in` (BaseInFilter), `job_type` (iexact), `contains_document_id` (custom method — parses UUID, filters `document_ids__contains=[uuid]`, returns `.none()` on bad UUID).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/ai-jobs/` | IsAuthenticated | List own jobs (filter `status`/`status__in`/`job_type`/`contains_document_id`; order by `created_at`). |
| GET | `/api/ai-jobs/{pk}/` | IsAuthenticated | Retrieve one job (poll `status`/`stage`/`progress`/`result`/`error`). |
| POST | `/api/ai-jobs/{pk}/cancel/` | IsAuthenticated | Set `cancel_requested=True` (if queued/running); returns the job. |
| POST | `/api/jobs/enqueue` | IsAuthenticated | Enqueue process-documents or profile-evaluation; returns 202 `{jobId, reused}`. |

### 8.9 Backfill management command

`management/commands/backfill_embeddings.py` — `Command(BaseCommand)`, optional `--user`. Selects PROCESSED docs with a non-empty `summary_path` (excluding MANUAL_INPUT, optionally per-user) and calls `index.reindex_document(doc)` (facts-only, no doc-chunk rows) for each. Used to (re)build the fact embeddings without reprocessing raw text. The reindex itself is AI-pipeline code — see [AI Document Ingestion Pipeline & RAG Q&A](./ai-ingestion-and-qa.md).

### 8.10 Admin (`apps/jobs/admin.py`)

`AiJobAdmin`, `AiJobEventAdmin` registered.

> **Gotchas:** (1) **Upload ≠ processing** — a second explicit `POST /api/jobs/enqueue` is required; there are no Django signals tying the two together. (2) Enqueue dedupe is overlap-based (processing) / "any active" (profile_evaluation); reused jobs are returned with `reused=True` and not re-dispatched. (3) `priority`/`attempts`/`locked_*` are vestiges of the legacy DB-polling worker — under Celery no lock is acquired, so a mid-flight RUNNING job re-delivered would re-run from scratch. (4) The 30-min stale cutoff vs the 5-min beat interval means a crashed worker's job is auto-failed within ~5–35 min.

---

## 9. App: `apps.timeline`

Chronological health events from multiple sources (AI-extracted, Apple Health, manual). Full owner-scoped CRUD plus bulk create. Events feed the Q&A context, pre-visit notes, and share PDFs. Label `timeline`.

### 9.1 Model — `TimelineEvent` (`apps/timeline/models.py`, `db_table="timeline_events"`)

`class TimelineEvent(BaseModel)` → UUID PK + timestamps. Inner `DatePrecision(TextChoices)` = `DAY`/`MONTH`/`YEAR`.

| Field | Type | Notes |
|---|---|---|
| `user` | FK `accounts.User`, CASCADE, `related_name="timeline_events"` | |
| `document` | FK `documents.Document`, **`on_delete=SET_NULL`**, null/blank, `related_name="timeline_events"` | events survive document deletion |
| `occurred_at` | DateField(null/blank) | |
| `date_precision` | CharField(10), choices `DatePrecision`, blank default "" | |
| `title` | CharField(512) | required |
| `event_type` | CharField(128), blank default "" | |
| `category` | CharField(128), blank default "" | |
| `source` | CharField(64), blank default "" | known values: `document_ai` (pipeline), `apple_health` (mobile bulk), `manual` |
| `summary` | TextField, blank default "" | |
| `tags` | `ArrayField(CharField(128), default=list)` | Postgres array |
| `data` | JSONField(default=dict) | arbitrary KV; pipeline builds it from a `data_kv` list |
| `included_in_previsit` | BooleanField(default=False) | selects events for the pre-visit note PDF |

`Meta`: `ordering=["-occurred_at"]`; indexes `["user","source"]` and `["user","included_in_previsit"]`.

### 9.2 Serializer & filter

- `TimelineEventSerializer(ModelSerializer)` — `exclude=["user"]`; adds read-only `document_title = CharField(source="document.title", default=None)`; `read_only_fields=["id","created_at","updated_at","document_title"]`.
- `TimelineEventFilter` (`Meta.fields=[]`): `source` (iexact), `exclude_source` (CharFilter `source` exclude), `included_in_previsit` (Boolean), `document` (UUIDFilter on `document_id`).

### 9.3 View — `TimelineEventViewSet(OwnedModelViewSet)` (`apps/timeline/views.py`)

`queryset = TimelineEvent.objects.select_related("document").all()` (owner-scoped), `filterset_class=TimelineEventFilter`, `ordering_fields=["occurred_at","created_at"]`, default `-occurred_at`.

- **Bulk create:** `get_serializer` is overridden — if the request `data` is a `list`, `many=True` is set, so `POST` accepts either one object or a JSON array (the Apple-Health sync path posts an array). All rows are still owner-stamped via `perform_create`.

### 9.4 Endpoints — timeline

Router base `timeline-events`, mounted at `api/`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/timeline-events/` | IsAuthenticated | List (filters: `source`, `exclude_source`, `included_in_previsit`, `document`; order: `occurred_at`/`created_at`). |
| POST | `/api/timeline-events/` | IsAuthenticated | Create one event **or** bulk-create (array body). |
| GET | `/api/timeline-events/{pk}/` | IsAuthenticated | Retrieve. |
| PUT / PATCH | `/api/timeline-events/{pk}/` | IsAuthenticated | Update (e.g. toggle `included_in_previsit`). |
| DELETE | `/api/timeline-events/{pk}/` | IsAuthenticated | Delete. |

How events are created: (1) the worker deletes existing `source="document_ai"` events for a `(user, document)` then `bulk_create`s new ones from extracted facts (idempotent per re-run); (2) the mobile client POSTs an array with `source="apple_health"`; (3) single manual POST. The fact→event mapping is AI-pipeline detail — see [AI Document Ingestion Pipeline & RAG Q&A](./ai-ingestion-and-qa.md).

### 9.5 Admin (`apps/timeline/admin.py`)

`TimelineEventAdmin`: `list_display=[id, user, title, occurred_at, source, included_in_previsit]`, `list_filter=[source, included_in_previsit]`, search `[title, user__email]`, `raw_id_fields=[user, document]`.

---

## 10. App: `apps.health`

Serves the user's latest computed health score/summary (`HealthProfile`), the append-only evaluation log (`HealthEvaluation`), and the RAG Q&A endpoint. The score data is **read-only via the API** — rows are written exclusively by the Celery pipeline. Label `health`.

### 10.1 Models (`apps/health/models.py`)

**`HealthProfile(TimeStampedModel)`** — `db_table="health_profiles"`. **The user is the primary key** (`OneToOneField(primary_key=True)`), so there is exactly one current profile per user (no `/health-profile/{id}` path).

| Field | Type | Notes |
|---|---|---|
| `user` | `OneToOneField("accounts.User", primary_key=True, on_delete=CASCADE, related_name="health_profile")` | the PK |
| `score` | IntegerField | from `evaluation["score_0_to_100"]` |
| `score_label` | CharField(64) | |
| `summary_json` | JSONField(default=dict) | keys: `overview`, `highlights`, `risk_flags`, `missing_info`, `suggested_next_steps`, `recommendations`, `full_summary_markdown`, `disclaimer` |
| `card_json` | JSONField(default=dict) | merged "3×5" emergency card (`blood_type`, `allergies`, `current_meds`, `major_conditions`, `emergency_contact{name,phone}`, `one_line_summary`, …) |
| `sources` | JSONField(default=dict) | provenance: `job_type`, `document_ids`, `apple_health`, `manual_profile`, `evaluation_storage_path`, `evaluation_id` |
| `version` | CharField(32, default `"profile_v2"`) | |
| `facts_digest` | JSONField(default=dict) | cached cross-doc facts digest; `{}` when raw-list fallback ran (forces rebuild next eval) |
| `digest_meta` | JSONField(default=dict) | `{doc_ids, suppression_sig, built_at}` |

The pipeline upserts this row each eval via `update_or_create`. The digest caching / merge logic is AI-pipeline detail — see [AI Document Ingestion Pipeline & RAG Q&A](./ai-ingestion-and-qa.md).

**`HealthEvaluation(BaseModel)`** — `db_table="health_evaluations"`, `ordering=["-created_at"]`, append-only: `user` FK CASCADE `related_name="health_evaluations"`, `score` IntegerField, `result` JSONField(default=dict) (full evaluation JSON incl. merged `three_by_five_card`). PK = uuid4.

### 10.2 Serializers (`apps/health/serializers.py`)

- `HealthProfileSerializer(ModelSerializer)` — `exclude=["user"]` (all JSON blobs + score + version exposed).
- `HealthEvaluationSerializer(ModelSerializer)` — `exclude=["user"]`.

### 10.3 Views

- `MyHealthProfileView(RetrieveAPIView)` (`apps/health/views.py`) — `serializer_class=HealthProfileSerializer`, `IsAuthenticated`. `get_object()` = `get_object_or_404(HealthProfile, user=request.user)` → **404 until the worker has produced a profile**.
- `HealthEvaluationViewSet(ReadOnlyOwnedViewSet)` — `queryset=HealthEvaluation.objects.all()` (owner-scoped), `ordering_fields=["created_at"]`, default `-created_at`. GET-only.
- `QAView(APIView)` (`apps/health/qa_views.py`) — `IsAuthenticated`, the RAG Q&A endpoint. `POST {question}` (truncated to `MAX_QUESTION=500`): 400 if empty; **503 `{"detail":"AI search is not configured."}` if `OPENAI_API_KEY` is unset**; else builds context (`build_qa_context`) and calls `ai_client.answer_health_question`, returning `{answer, sources}`. The retrieval + LLM internals (`index.search`, context assembly, model fallback) are in [AI Document Ingestion Pipeline & RAG Q&A](./ai-ingestion-and-qa.md).

### 10.4 Endpoints — health

Mounted at `api/` (router base `health-evaluations` + two explicit paths).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health-profile` | IsAuthenticated | Current user's latest profile/score/summary/card (404 until worker runs). |
| POST | `/api/qa` | IsAuthenticated | Ask a question about own records (RAG). 503 if `OPENAI_API_KEY` unset. |
| GET | `/api/health-evaluations/` | IsAuthenticated | List own evaluations (ordered `-created_at`). |
| GET | `/api/health-evaluations/{pk}/` | IsAuthenticated | Retrieve one evaluation (uuid pk). |

### 10.5 Admin (`apps/health/admin.py`)

`HealthProfileAdmin`: list `[user, score, score_label, version, updated_at]`, search `user__email`, raw_id `user`. `HealthEvaluationAdmin`: list `[id, user, score, created_at]`, search `user__email`, raw_id `user`.

---

## 11. App: `apps.shares`

Time- and view-limited **public** share links of health artifacts (PDFs). The owner creates a link → the server generates PDFs to object storage, stores only the SHA-256 of the token, and sets a short expiry + view cap. A public (unauthenticated) endpoint resolves the token (optionally with a PIN) and returns short-lived signed PDF URLs. Security-critical. Label `shares`.

### 11.1 Model — `SharePackage` (`apps/shares/models.py`, `db_table="share_packages"`)

`class SharePackage(BaseModel)` → UUID PK + timestamps. Inner `FileType(TextChoices)` has only `HEALTH_PROFILE="health_profile"`.

| Field | Type | Notes |
|---|---|---|
| `owner` | FK `accounts.User`, CASCADE, `related_name="share_packages"` | |
| `token_hash` | CharField(64, **unique, db_index**) | stores `sha256(token).hexdigest()` only — the raw token is never persisted |
| `file_type` | CharField(20), choices `FileType` | vestigial — always `health_profile`; the real artifact kinds live in `payload_json["types"]` |
| `expires_at` | DateTimeField | required |
| `revoked` | BooleanField(default=False) | honored in resolve; **no API endpoint sets it** (admin-only) |
| `max_views` | IntegerField(null/blank) | |
| `views_count` | IntegerField(default=0) | |
| `pin_hash` | CharField(128, blank default "") | `sha256(pin)`; "" = no PIN |
| `pin_attempts` | IntegerField(default=0) | |
| `payload_json` | JSONField(default=dict) | `{"types": [...], "pdfs": {share_type: storage_key}}` |
| `artifacts_deleted_at` | DateTimeField(null/blank) | set when PDFs are purged on expiry |

`Meta.ordering=["-created_at"]`. Migrations: `0001`, `0002` (deleted a defunct `SharePackageItem` join table), `0003` (narrowed `file_type` choices to just `health_profile`).

### 11.2 Services (`apps/shares/services.py`)

`VALID_TYPES = {"full_summary", "card_3x5", "pre_visit_note", "full_timeline"}` (the share artifact kinds — distinct from the model's `file_type`). `_hash(value)` = sha256 hexdigest.

- **`create_share(user, share_types, pin=None) -> (token, SharePackage)`** — filters `share_types` to `VALID_TYPES` (defaults to `["full_summary"]`); for each type builds PDF bytes (`pdf.build_pdf(t, user.id)`) and saves to `share-artifacts/{uuid4hex}/{t}.pdf`; `token = secrets.token_urlsafe(32)` (the **only** place the raw token exists); creates the package with `token_hash=_hash(token)`, `file_type=HEALTH_PROFILE`, `expires_at = now + SHARE_EXPIRES_MINUTES`, `max_views=SHARE_MAX_VIEWS`, `pin_hash=_hash(pin) if pin else ""`, `payload_json={"types","pdfs"}`.
- **`resolve_share(token, pin=None) -> dict`** — looks up by `token_hash`; returns a dict carrying a `status` key the view pops to set the HTTP status:

| Condition | Result |
|---|---|
| missing OR `revoked` | `{"error":"Not found","status":404}` |
| `now() >= expires_at` | purge artifacts (if not yet) → `{"error":"This link has expired","status":410}` |
| `pin_hash` set & `pin_attempts >= SHARE_MAX_PIN_ATTEMPTS` | `{"error":"Too many attempts","pinRequired":True,"status":429}` |
| `pin_hash` set & no pin | `{"pinRequired":True,"status":401}` |
| `pin_hash` set & wrong pin (`secrets.compare_digest`) | increment `pin_attempts` → `{"error":"Wrong PIN","pinRequired":True,"status":401}` |
| `max_views` reached | `{"error":"View limit reached","status":410}` |
| success | increment `views_count` → `{"items":[{title, signedUrl (120s), expiresIn:120}], "expiresAt": iso, "pinRequired": False}` |

PDF generation (`apps/shares/pdf.py`) uses **reportlab** (lazy-imported), direct `drawString` canvas. `TITLES` maps each share type to a heading; lines are pulled from `HealthProfile` (card/summary) and `UserProfile` (name) and (for `pre_visit_note`/`full_timeline`) `TimelineEvent`s. `full_timeline` excludes `source="apple_health"`; `pre_visit_note` includes only `included_in_previsit=True` (max 50).

### 11.3 Views (`apps/shares/views.py`)

- `CreateShareView(APIView)` — `IsAuthenticated`. `POST` reads `shareTypes`/`share_types` (default []) + `pin`; `create_share(...)`; returns **201** `{"packageId": str(id), "shareUrl": f"{SHARE_PUBLIC_URL}?token={token}", "expiresAt": iso}`. The raw token is returned **once** here, embedded in the share URL.
- `ResolveShareView(APIView)` — **`AllowAny` (public)**, `throttle_scope="share_resolve"` (ScopedRateThrottle → 30/min in prod). `POST` requires `token` (400 if missing); `resolve_share(token, body["pin"])`; returns the dict with HTTP status popped from `status` (default 200).

### 11.4 Endpoints — shares

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/shares` | IsAuthenticated | Create a share link; generate PDFs; return `{packageId, shareUrl, expiresAt}` (201). |
| POST | `/api/shares/resolve` | AllowAny (throttled `share_resolve`) | Public resolve token (+ optional PIN) → signed PDF URLs. |

There is **no list/retrieve/delete/revoke** endpoint for shares — `revoked` is admin-only. The [web app](./web-app.md) hosts the public resolver UI at `/share?token=…`.

### 11.5 Admin (`apps/shares/admin.py`)

`SharePackageAdmin`: list `[id, owner, file_type, expires_at, views_count, revoked]`, `list_filter=[file_type, revoked]`, search `owner__email`, raw_id `owner`.

> **Share security model:** only `sha256(token)` and `sha256(pin)` are stored (never plaintext); the token is `secrets.token_urlsafe(32)`; PIN compare is constant-time (`secrets.compare_digest`); per-link expiry (default 1 min), view cap (default 2), and PIN-attempt cap (default 5) are all server-enforced and not client-overridable. Resolved PDF URLs are signed for 120s. PDFs are purged from storage on the first resolve after expiry; there is no scheduled cleanup of expired-but-never-resolved links (the only beat job is `recover-stale-jobs`).

---

## 12. Complete endpoint index

| App | Method | Path | Auth |
|---|---|---|---|
| accounts | POST | `/api/auth/register` | AllowAny |
| accounts | POST | `/api/auth/login` | AllowAny |
| accounts | POST | `/api/auth/token/refresh` | AllowAny |
| accounts | POST | `/api/auth/logout` | IsAuthenticated |
| accounts | GET | `/api/auth/me` | IsAuthenticated |
| accounts | POST | `/api/auth/verify-email` | AllowAny |
| accounts | POST | `/api/auth/password/forgot` | AllowAny |
| accounts | POST | `/api/auth/password/reset` | AllowAny |
| accounts | POST | `/api/auth/password/change` | IsAuthenticated |
| accounts | DELETE | `/api/account` | IsAuthenticated |
| profiles | GET/PUT/PATCH | `/api/profile` | IsAuthenticated |
| profiles | POST | `/api/profile/link-health` | IsAuthenticated |
| profiles | POST | `/api/profile/unlink-health` | IsAuthenticated |
| profiles | GET/POST/DELETE | `/api/profile/avatar` | IsAuthenticated |
| documents | GET/POST | `/api/documents/` | IsAuthenticated |
| documents | GET/PUT/PATCH/DELETE | `/api/documents/{pk}/` | IsAuthenticated |
| documents | POST | `/api/documents/upload/` | IsAuthenticated |
| documents | GET | `/api/documents/{pk}/file/` | IsAuthenticated |
| jobs | POST | `/api/jobs/enqueue` | IsAuthenticated |
| jobs | GET | `/api/ai-jobs/` | IsAuthenticated |
| jobs | GET | `/api/ai-jobs/{pk}/` | IsAuthenticated |
| jobs | POST | `/api/ai-jobs/{pk}/cancel/` | IsAuthenticated |
| timeline | GET/POST | `/api/timeline-events/` | IsAuthenticated |
| timeline | GET/PUT/PATCH/DELETE | `/api/timeline-events/{pk}/` | IsAuthenticated |
| health | GET | `/api/health-profile` | IsAuthenticated |
| health | POST | `/api/qa` | IsAuthenticated |
| health | GET | `/api/health-evaluations/` | IsAuthenticated |
| health | GET | `/api/health-evaluations/{pk}/` | IsAuthenticated |
| shares | POST | `/api/shares` | IsAuthenticated |
| shares | POST | `/api/shares/resolve` | AllowAny (throttled) |
| (project) | GET | `/healthz` | AllowAny |
| (project) | GET | `/api/schema/` | AllowAny |
| (project) | GET | `/api/docs/` | AllowAny |

---

## 13. Data-model map

```mermaid
erDiagram
    USER ||--o| USERPROFILE : "profile (OneToOne)"
    USER ||--o| HEALTHPROFILE : "health_profile (OneToOne, user=PK)"
    USER ||--o{ DOCUMENT : "documents"
    USER ||--o{ TIMELINEEVENT : "timeline_events"
    USER ||--o{ AIJOB : "ai_jobs"
    USER ||--o{ HEALTHEVALUATION : "health_evaluations"
    USER ||--o{ EMBEDDING : "embeddings"
    USER ||--o{ SHAREPACKAGE : "share_packages"
    DOCUMENT ||--o{ TIMELINEEVENT : "document (SET_NULL)"
    DOCUMENT ||--o{ EMBEDDING : "document (CASCADE, nullable)"
    AIJOB ||--o{ AIJOBEVENT : "events (CASCADE)"

    USER { uuid id PK }
    USERPROFILE { uuid id PK }
    HEALTHPROFILE { uuid user PK }
    DOCUMENT { uuid id PK }
    TIMELINEEVENT { uuid id PK }
    AIJOB { uuid id PK }
    AIJOBEVENT { bigint id PK }
    EMBEDDING { uuid id PK }
    HEALTHEVALUATION { uuid id PK }
    SHAREPACKAGE { uuid id PK }
```

| Model | App | `db_table` | PK | Owner FK |
|---|---|---|---|---|
| `User` | accounts | `users` | UUID | — |
| `UserProfile` | profiles | `user_profiles` | UUID | `user` (OneToOne) |
| `Document` | documents | `documents` | UUID | `user` |
| `AiJob` | jobs | `ai_jobs` | UUID | `user` |
| `AiJobEvent` | jobs | `ai_job_events` | BigAutoField | (via `job`) |
| `Embedding` | jobs | `embeddings` | UUID | `user` (+ nullable `document`) |
| `TimelineEvent` | timeline | `timeline_events` | UUID | `user` (+ nullable `document`) |
| `HealthProfile` | health | `health_profiles` | **user** (OneToOne PK) | `user` |
| `HealthEvaluation` | health | `health_evaluations` | UUID | `user` |
| `SharePackage` | shares | `share_packages` | UUID | `owner` |

For the full end-to-end flows (upload → process → evaluate → score, share lifecycle, Apple-Health sync), see [Data Model & End-to-End Flows](./data-model-and-flows.md).

---

## 14. Configuration & environment variables

All read in `config/settings/base.py` via `django-environ`. Defaults shown are the in-code defaults (dev-safe only).

### Core / DB / auth

| Var | Default | Purpose |
|---|---|---|
| `DJANGO_SECRET_KEY` | dev placeholder | Django secret key |
| `DJANGO_DEBUG` | `True` | debug mode (in `base.py`; `dev.py` forces True) |
| `DJANGO_ALLOWED_HOSTS` | `["*"]` | allowed hosts |
| `DATABASE_URL` | `postgres://rivr:rivr@localhost:5432/rivr` | Postgres (pgvector/ArrayField required) |

### Celery / Redis

| Var | Default |
|---|---|
| `CELERY_BROKER_URL` | `redis://localhost:6379/0` |
| `CELERY_RESULT_BACKEND` | `redis://localhost:6379/1` |
| `CELERY_TASK_ALWAYS_EAGER` | `False` (True in tests) |

### Object storage (S3 / MinIO)

| Var | Default | Notes |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | `""` | presence flips default storage to `S3Storage` |
| `AWS_SECRET_ACCESS_KEY` | `""` | |
| `AWS_STORAGE_BUCKET_NAME` | `rivr-media` | |
| `AWS_S3_ENDPOINT_URL` | `""` | MinIO endpoint |
| `AWS_S3_REGION_NAME` | `us-east-1` | |

When S3 is active: `AWS_S3_ADDRESSING_STYLE="path"`, `AWS_QUERYSTRING_AUTH=True`, `AWS_QUERYSTRING_EXPIRE=600`, `AWS_DEFAULT_ACL=None`, `AWS_S3_FILE_OVERWRITE=False`.

### CORS / email / frontend / shares

| Var | Default | Notes |
|---|---|---|
| `CORS_ALLOW_ALL_ORIGINS` | `True` | default-allow-all (prod gotcha) |
| `CORS_ALLOWED_ORIGINS` | `[]` | |
| `EMAIL_BACKEND` | SMTP backend | locmem in tests |
| `EMAIL_HOST` | `localhost` | Compose `.env` = `mailpit` |
| `EMAIL_PORT` | `1025` | Mailpit SMTP |
| `DEFAULT_FROM_EMAIL` | `RIVR <no-reply@rivrhealth.local>` | |
| `FRONTEND_URL` | `http://localhost:3000` | verify/reset link base |
| `SHARE_PUBLIC_URL` | `http://localhost:3000/share` | shareUrl base |
| `SHARE_EXPIRES_MINUTES` | `1` | link lifetime |
| `SHARE_MAX_VIEWS` | `2` | view cap |
| `SHARE_MAX_PIN_ATTEMPTS` | `5` | PIN brute-force cap |

### AI / embeddings (consumed by the AI pipeline; configured here)

| Var | Default |
|---|---|
| `OPENAI_API_KEY` | `""` (gates `/api/qa` — 503 if empty) |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` |
| `AI_MODEL_EXTRACT` | `gpt-4o-2024-08-06` |
| `AI_MODEL_EVAL` | `gpt-4o-2024-08-06` |
| `AI_MODEL_OCR` | `gpt-4o-mini` |
| `AI_MODEL_TRANSCRIBE` | `whisper-1` |
| `AI_MODEL_QUESTION_ANSWER` | `""` (empty → Q&A uses `AI_MODEL_EVAL`) |
| `EMBEDDING_BASE_URL` | = `OPENAI_BASE_URL` |
| `EMBEDDING_API_KEY` | = `OPENAI_API_KEY` |
| `EMBEDDING_MODEL` | `nomic-embed-text-v1.5` |
| `EMBEDDING_DIM` | `768` |
| `OCR_MIN_IMAGE_PX` | `100` |
| `OCR_BATCH_SIZE` | `10` |

Full meaning of the AI/embedding vars is in [AI Document Ingestion Pipeline & RAG Q&A](./ai-ingestion-and-qa.md). See also [Technology Stack Reference](./tech-stack.md) for library versions.

> **Gotchas:** (1) `EMBEDDING_DIM` (settings) is **decoupled** from the hardcoded `768` in `apps/jobs/embeddings.py` and `VectorField(dimensions=768)` — changing the env will not migrate the DB column. (2) `backend/.env` (committed) holds a real-looking `OPENAI_API_KEY` and `.env.local` a Vercel OIDC token — secrets in repo. (3) `base.py` always reads `backend/.env`, layering on top of Compose's `env_file`.

---

## 15. Tests

- `pytest.ini`: `DJANGO_SETTINGS_MODULE = config.settings.test`, `python_files = tests.py test_*.py *_tests.py`, `addopts = -ra --strict-markers`.
- `conftest.py`: single fixture `api_client` → DRF `APIClient()`.
- Suite under `backend/tests/`: `test_auth`, `test_api`, `test_pipeline`, `test_qa`, `test_index`, `test_embeddings`, `test_extraction`, `test_storage`, `test_jobs_enqueue`, `test_models`, `test_pdf_ingestion`, `test_profile_logic`, `test_shares`, `test_smoke`.
- Tests hit **real Postgres** (pgvector/ArrayField) but use `InMemoryStorage`, **eager Celery** (jobs run inline), the MD5 password hasher, locmem email, and no whitenoise.

---

## 16. Cross-references

- AI fact extraction, OCR, transcription, embeddings, RAG retrieval, pydantic schemas → [AI Document Ingestion Pipeline & RAG Q&A](./ai-ingestion-and-qa.md)
- Mobile client API usage, token storage, polling → [Mobile App](./mobile-app.md)
- Public reset/verify/share resolver pages → [Web App](./web-app.md)
- End-to-end data flows → [Data Model & End-to-End Flows](./data-model-and-flows.md)
- Docker, Compose, settings-module deployment caveats, MinIO URL caveat → [Build, Deploy & Infrastructure](./build-deploy-infra.md)
- Library versions / runtime stack → [Technology Stack Reference](./tech-stack.md)