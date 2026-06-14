# Architecture Overview

This document describes the **system architecture** of RIVR Health AI in depth: the components, the request/response paths, the asynchronous processing model, how clients authenticate and talk to the backend, where files and vectors live, and where AI runs. It is written for engineers new to the codebase and is intentionally thorough.

For the bird's-eye index and per-area deep dives, see:

- [Documentation Index & System Overview](./README.md)
- [Backend Services (Django / DRF / Celery)](./backend-services.md) — per-app endpoint, model, and view detail
- [AI Document Ingestion Pipeline & RAG Q&A](./ai-ingestion-and-qa.md) — the AI internals this doc only sketches
- [Mobile App (Expo / React Native)](./mobile-app.md) — client navigation, contexts, screens
- [Web App (Next.js)](./web-app.md) — the public reset/verify/share web flows
- [Data Model & End-to-End Flows](./data-model-and-flows.md) — table-by-table schema + flow traces
- [Build, Deploy & Infrastructure](./build-deploy-infra.md) — Docker, compose, EAS, the `./dev` launcher
- [Technology Stack Reference](./tech-stack.md) — every library + version

---

## 1. System at a glance

RIVR Health AI is a **mobile-first personal health record** with AI document understanding. There are three deployable surfaces backed by a single API:

1. **Backend** — a Django 5.1 / Django REST Framework (DRF) service plus a Celery worker and Celery beat scheduler. Code root: `backend/`. Project package: `config/`.
2. **Mobile app** — an Expo / React Native (TypeScript) client. Code root: repository root (`src/`, `App.tsx`, `app.json`). This is the primary product surface.
3. **Web app** — a small public Next.js 15 companion (`web/`) that hosts the three flows that must run in a browser from an email link or external device: **password reset**, **email verification**, and the **public share viewer**.

Supporting infrastructure (all local-dev via Docker Compose, see [build-deploy-infra.md](./build-deploy-infra.md)):

- **PostgreSQL 16 with the `pgvector` extension** (`pgvector/pgvector:pg16`) — the single source of truth for relational data **and** the Q&A vector index.
- **Redis 7** — the Celery broker (DB 0) and result backend (DB 1).
- **S3-compatible object storage** (MinIO locally) — uploaded files, per-document fact summaries, evaluation JSON, avatars, and generated share PDFs.
- **OpenAI (or an OpenAI-compatible endpoint)** — fact extraction, health evaluation, OCR, audio transcription, embeddings, and RAG answering. Embeddings default to a Nomic model and can point at a separate endpoint.
- **SMTP** (Mailpit locally) — verification and password-reset email.

```mermaid
graph TB
    subgraph Clients
        M["Mobile app<br/>(Expo / React Native)"]
        W["Web app<br/>(Next.js, public)"]
    end

    subgraph Backend["Django backend (config/)"]
        API["DRF API<br/>gunicorn / runserver"]
        WK["Celery worker"]
        BEAT["Celery beat<br/>(recover-stale-jobs, 5 min)"]
    end

    subgraph Data
        PG[("PostgreSQL 16<br/>+ pgvector")]
        RDS[("Redis 7<br/>broker + results")]
        OBJ[("Object storage<br/>S3 / MinIO")]
    end

    subgraph External
        AI["OpenAI / compatible<br/>extract · eval · OCR · whisper"]
        EMB["Embeddings endpoint<br/>(Nomic / OpenAI-compatible)"]
        SMTP["SMTP (Mailpit)"]
    end

    M -- "HTTPS + JWT Bearer" --> API
    W -- "HTTPS (token in URL)" --> API
    API <--> PG
    API -- "send_task (on commit)" --> RDS
    API --> OBJ
    API -- "verify/reset email" --> SMTP
    API -- "QA / answer" --> AI
    API -- "search query embed" --> EMB

    RDS --> WK
    BEAT --> RDS
    WK <--> PG
    WK <--> OBJ
    WK --> AI
    WK --> EMB
```

The defining architectural choice: **uploads and AI processing are decoupled.** The synchronous API never calls OpenAI on the request path for ingestion. Uploading a document only writes a blob + a DB row; the AI work happens later in a Celery task that the client must explicitly enqueue and then poll. The only place the API calls OpenAI synchronously is the **Q&A endpoint** (`POST /api/qa`), which is interactive by nature.

---

## 2. Backend process model & settings

### 2.1 Django project shape

The project package is `config/` (distinct from the app names). Key wiring (see `backend/config/`):

| Concern | Setting / file |
|---|---|
| URL root | `ROOT_URLCONF = "config.urls"` (`backend/config/urls.py`) |
| WSGI (gunicorn) | `WSGI_APPLICATION = "config.wsgi.application"` |
| ASGI | `ASGI_APPLICATION = "config.asgi.application"` |
| Celery app | `config/celery.py` → `Celery("rivr")`, re-exported as `config.celery_app` in `config/__init__.py` |
| Local apps | `apps.common`, `apps.accounts`, `apps.profiles`, `apps.documents`, `apps.timeline`, `apps.health`, `apps.jobs`, `apps.shares` |

All entry points default the settings module to **`config.settings.dev`**: `manage.py`, `config/wsgi.py:5`, `config/asgi.py:5`, `config/celery.py:5` all call `os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")`.

Settings are split under `backend/config/settings/`:

- `base.py` — the real settings, env-driven via `django-environ`. It explicitly reads `backend/.env` (`environ.Env.read_env(BASE_DIR / ".env")`, `base.py:14`) **in addition to** anything Docker Compose injects via `env_file`.
- `dev.py` — `from .base import *` then `DEBUG = True`.
- `test.py` — eager Celery, in-memory storage, MD5 password hasher, locmem email, raised throttle limits.

> **Gotcha:** there is **no `config.settings.prod`**. The WSGI app and gunicorn both inherit the `config.settings.dev` default unless `DJANGO_SETTINGS_MODULE` is overridden in the environment — so production runs `DEBUG=True` and `CORS_ALLOW_ALL_ORIGINS=True` (default) unless explicitly overridden. See [build-deploy-infra.md](./build-deploy-infra.md) for the full posture and remediation notes.

### 2.2 The three backend processes

The backend is one codebase running as three process roles (Docker Compose service names in parentheses):

```
┌──────────────────────────────────────────────────────────────┐
│  web (Django)   — serves the DRF API (runserver in compose,   │
│                   gunicorn in the Docker image CMD)            │
│  worker (Celery)— celery -A config worker -l info             │
│  beat (Celery)  — celery -A config beat -l info               │
└──────────────────────────────────────────────────────────────┘
        │ shares the same DB, Redis, object storage
        ▼
   db (Postgres+pgvector) · redis · minio · mailpit
```

- **`web`** handles all synchronous HTTP. In `docker-compose.yml` it runs `python manage.py migrate && runserver 0.0.0.0:8000`; the production image's `CMD` is `gunicorn config.wsgi:application --bind 0.0.0.0:8000`.
- **`worker`** runs the ingestion / evaluation pipeline tasks (`apps.jobs.tasks.*` → `pipeline.run_job`).
- **`beat`** runs one periodic task, `recover-stale-jobs` (every 300 s), which fails RUNNING jobs whose `updated_at` is older than 30 minutes (crash recovery).

### 2.3 Middleware order

`MIDDLEWARE` (`base.py:48-58`) — order matters:

```
corsheaders.CorsMiddleware            ← CORS first (correct)
security.SecurityMiddleware
whitenoise.WhiteNoiseMiddleware       ← static files
sessions.SessionMiddleware
common.CommonMiddleware
csrf.CsrfViewMiddleware
auth.AuthenticationMiddleware
messages.MessageMiddleware
clickjacking.XFrameOptionsMiddleware
```

API authentication is **JWT**, not session-based, so the session/CSRF middleware mainly serve the Django admin. Static assets are served by **whitenoise**.

---

## 3. Authentication & the request path

### 3.1 JWT model

Auth is JSON Web Token via `djangorestframework-simplejwt`. DRF defaults (`base.py:128-144`) make the entire API **authenticated-by-default**:

| Setting | Value |
|---|---|
| `DEFAULT_AUTHENTICATION_CLASSES` | `rest_framework_simplejwt.authentication.JWTAuthentication` |
| `DEFAULT_PERMISSION_CLASSES` | `rest_framework.permissions.IsAuthenticated` |
| `DEFAULT_PAGINATION_CLASS` | `LimitOffsetPagination`, `PAGE_SIZE = 30` |
| `DEFAULT_FILTER_BACKENDS` | `DjangoFilterBackend`, `OrderingFilter` |
| `DEFAULT_THROTTLE_CLASSES` | `ScopedRateThrottle` (rate `share_resolve: 30/min`) |

SIMPLE_JWT config (`base.py:153-158`):

| Token | Lifetime | Behavior |
|---|---|---|
| Access | `timedelta(minutes=30)` | Bearer token on every request |
| Refresh | `timedelta(days=30)` | Exchanged for new access tokens |
| Rotation | `ROTATE_REFRESH_TOKENS=True` | Refresh returns a **new** refresh token... |
| Blacklist | `BLACKLIST_AFTER_ROTATION=True` | ...and blacklists the old one (`rest_framework_simplejwt.token_blacklist` app) |

The custom user model is `accounts.User` (`AUTH_USER_MODEL`), keyed by **email** and a **UUID primary key** (`db_table = "users"`). It has no name fields — those live on `UserProfile` (`profiles` app). Full auth/profile detail (serializers, email tokens, account deletion) is in [backend-services.md](./backend-services.md); the cross-cutting auth tables and flows are in [data-model-and-flows.md](./data-model-and-flows.md).

### 3.2 Auth endpoints (the public seam)

Mounted at `api/auth/` (`apps.accounts.urls`) plus a standalone delete endpoint:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | AllowAny | Create user, send verify email, return `{user, access, refresh}` (201) |
| POST | `/api/auth/login` | AllowAny | Validate email+password → `{access, refresh, user}` |
| POST | `/api/auth/token/refresh` | AllowAny | Rotate access (+refresh) token |
| POST | `/api/auth/logout` | IsAuthenticated | Blacklist supplied refresh token (205) |
| GET | `/api/auth/me` | IsAuthenticated | Current user |
| POST | `/api/auth/verify-email` | AllowAny | Consume signed token, set `email_verified_at` |
| POST | `/api/auth/password/forgot` | AllowAny | Send reset email (always 200, no enumeration) |
| POST | `/api/auth/password/reset` | AllowAny | `{uid, token, password}` → set password |
| POST | `/api/auth/password/change` | IsAuthenticated | Change own password |
| DELETE | `/api/account` | IsAuthenticated | Delete user + their object-storage prefixes (204) |

> **Edge case:** email verification is **not enforced** for login/API access — `email_verified_at` is informational. And password change/reset does **not** revoke already-issued JWTs (access tokens live until their 30-minute expiry; refresh tokens up to 30 days).

### 3.3 Login & authenticated-request sequence

```mermaid
sequenceDiagram
    participant App as Mobile client
    participant API as DRF API
    participant DB as Postgres

    Note over App: 1. Login
    App->>API: POST /api/auth/login {email, password}
    API->>DB: validate credentials (accounts.User)
    API-->>App: {access (30m), refresh (30d), user}
    Note over App: store in AsyncStorage:<br/>rivr.access / rivr.refresh

    Note over App: 2. Authenticated request
    App->>API: GET /api/health-profile<br/>Authorization: Bearer <access>
    API->>API: JWTAuthentication → request.user
    API->>DB: owner-scoped query
    API-->>App: 200 payload

    Note over App: 3. Access token expired
    App->>API: GET /api/... (stale access)
    API-->>App: 401
    App->>API: POST /api/auth/token/refresh {refresh}
    API-->>App: {access, refresh} (rotated; old refresh blacklisted)
    App->>API: retry original request (once)
    API-->>App: 200
```

The mobile client implements exactly this in `src/lib/api/client.ts`: it attaches `Authorization: Bearer <access>`, and on a `401` with `retry` enabled it calls `tryRefresh()` (`POST /api/auth/token/refresh`), rotates both tokens, and replays the request **once** (`retry:false`). If refresh fails, it clears tokens and fires an `onUnauthorized` handler that `SessionContext` registered to drop the user back to the Login screen. Details: [mobile-app.md](./mobile-app.md).

### 3.4 Object ownership & multi-tenancy

Per-user isolation is enforced by shared base classes in `apps/common/`:

- `OwnedModelViewSet` (`apps/common/viewsets.py`) — `owner_field = "user"`, `permission_classes = [IsAuthenticated, IsOwner]`. `get_queryset()` filters `{owner_field: request.user}`, so **another user's row 404s rather than 403s** (no existence leak). `perform_create` stamps the owner.
- `ReadOnlyOwnedViewSet` — same, restricted to GET/HEAD/OPTIONS.
- `IsOwner` (`apps/common/permissions.py`) — an object-level defence-in-depth check (`obj.{owner_field}_id == request.user.id`).

The public exception is the **share resolve** endpoint (`AllowAny`, throttled), which is the only unauthenticated read path and is hardened separately (see §7).

---

## 4. The asynchronous processing model (Celery + Redis)

### 4.1 Why async

AI ingestion is slow and multi-step (download → PDF/text extraction → OCR → transcription → LLM fact extraction → embeddings → LLM evaluation). Doing this on the HTTP request would block for tens of seconds and fail under timeouts. Instead, RIVR records a **job** in Postgres and dispatches a Celery task; the client polls the job row for stage/progress.

### 4.2 Celery wiring

`config/celery.py` creates `Celery("rivr")`, configures from Django settings with the `CELERY_` namespace, and autodiscovers `@shared_task`s. Settings (`base.py:164-174`):

| Setting | Default | Notes |
|---|---|---|
| `CELERY_BROKER_URL` | `redis://localhost:6379/0` | Redis DB 0 = broker |
| `CELERY_RESULT_BACKEND` | `redis://localhost:6379/1` | Redis DB 1 = results |
| `CELERY_TASK_ALWAYS_EAGER` | `False` (`True` in tests) | Eager = run inline, no broker |
| `CELERY_TASK_TRACK_STARTED` | `True` | |
| `CELERY_BEAT_SCHEDULE` | `{recover-stale-jobs: every 300s}` | crash recovery |

The three `@shared_task` entry points (`apps/jobs/tasks.py`) are thin wrappers:

| Task name | Calls |
|---|---|
| `apps.jobs.tasks.process_documents_task(job_id)` | `pipeline.run_job(job_id)` |
| `apps.jobs.tasks.profile_evaluation_task(job_id)` | `pipeline.run_job(job_id)` |
| `apps.jobs.tasks.recover_stale_jobs_task()` | `pipeline.recover_stale_jobs()` (beat) |

### 4.3 The job record

`AiJob` (`apps/jobs/models.py`, `db_table="ai_jobs"`, UUID PK) is the durable async-state machine. The client never trusts Celery's result backend for UI; it polls this row:

| Field | Role |
|---|---|
| `job_type` | `process_documents` \| `profile_evaluation` |
| `document_ids` | `ArrayField(UUIDField)` (Postgres array; the docs to process) |
| `status` | `queued` → `running` → `succeeded` \| `failed` \| `cancelled` |
| `stage` | human-readable progress stage (e.g. `downloading_file`, `openai_extract`, `openai_eval`) |
| `heartbeat_at` | bumped on each stage change |
| `progress` | JSON, e.g. `{total, done, currentDocId}` |
| `result` | JSON on success, e.g. `{health_profile_updated: true, evaluation_id}` |
| `error` | failure message |
| `cancel_requested` / `cancelled_at` | cooperative cancellation flag |

`AiJobEvent` (`db_table="ai_job_events"`) is an append-only structured log per job (`level`, `message`, `data`). Index on `AiJob(user, status)`.

> The `priority`, `attempts`, `locked_at`, `locked_by` fields are **vestiges of a legacy DB-polling worker** and are not used as concurrency controls under Celery.

### 4.4 Enqueue, dispatch, poll

The decoupling is enforced precisely:

1. **Upload** (`POST /api/documents/upload/`) creates a `Document(status=uploaded)` and **stops** — there are no Django signals tying upload to processing.
2. The client separately **enqueues** (`POST /api/jobs/enqueue`). `EnqueueView` (`apps/jobs/views.py:38-60`) resolves the job type and document ids, calls the enqueue service, and dispatches **after the DB transaction commits**:

```python
# apps/jobs/views.py
if not reused:
    transaction.on_commit(lambda: celery_app.send_task(task, args=[str(job.id)]))
return Response({"jobId": str(job.id), "reused": reused}, status=202)
```

`transaction.on_commit` is the key correctness detail: the same transaction creates the job **and** flips the target documents to `processing`, so the worker must not see the task before those rows are committed — otherwise it would race and find no work.

The enqueue services (`apps/jobs/services.py`) also **dedupe**: an active `process_documents` job whose `document_ids` array **overlaps** the requested ids is reused (`reused=True`) and **not** re-dispatched (its task is presumed in-flight); `profile_evaluation` reuses any active such job.

```mermaid
sequenceDiagram
    autonumber
    participant App
    participant API as DRF (web)
    participant DB as Postgres
    participant R as Redis broker
    participant WK as Celery worker
    participant OBJ as Object storage
    participant AI as OpenAI / Embeddings

    App->>API: POST /api/documents/upload/ (multipart file)
    API->>OBJ: save blob → documents/{user}/{kind}/...
    API->>DB: Document(status=uploaded, sha256, pdf_path)
    API-->>App: 201 Document

    App->>API: POST /api/jobs/enqueue {documentIds}
    API->>DB: AiJob(queued) + mark docs PROCESSING (one txn)
    API->>R: send_task(...) on commit
    API-->>App: 202 {jobId, reused}

    R->>WK: process_documents_task(job_id)
    WK->>DB: AiJob → running, stages...
    WK->>OBJ: read blob
    WK->>AI: extract facts / OCR / transcribe
    WK->>OBJ: write per-doc summary.json
    WK->>DB: write TimelineEvents + Embeddings
    WK->>AI: evaluate_user_health(...)
    WK->>DB: upsert HealthProfile + append HealthEvaluation
    WK->>DB: AiJob → succeeded; docs PROCESSED

    loop poll until terminal
        App->>API: GET /api/ai-jobs/{id}/
        API->>DB: read AiJob
        API-->>App: {status, stage, progress, result}
    end
```

The mobile UI polls **two** loops while work is in flight: documents every 4 s (`?exclude_status=processed`) and jobs every 1.5 s (`?status__in=queued,running`), mapping `job.stage` to a progress bar via a `STAGE_INFO` table that mirrors `apps/jobs/pipeline.py`. See [mobile-app.md](./mobile-app.md) (`ListDocuments.tsx`).

### 4.5 Job lifecycle, cancellation, recovery

`pipeline.run_job(job_id)` is the orchestration driver:

- **Idempotent re-delivery:** if the job is missing or already `succeeded`/`cancelled`, it returns (safe to re-deliver).
- **Branch:** `process_documents` extracts each non-manual document (excluding `manual_input`), then runs the shared evaluation tail; `profile_evaluation` runs the tail only.
- **Cooperative cancellation:** `POST /api/ai-jobs/{id}/cancel/` only sets `cancel_requested=True`. The pipeline re-reads that flag at checkpoints (`_check_cancelled`) and raises `CancellationError`, which reverts its `processing` docs back to `uploaded`.
- **Failure:** any other exception → `_fail(job, str(exc))` then **re-raises** so Celery records the failure.
- **Stale recovery:** `recover_stale_jobs()` (beat, every 5 min) fails RUNNING jobs idle for **30 min** and reverts their docs to `uploaded` for retry.

The AI internals invoked inside the pipeline (`extraction.py`, `ai_client.py`, `embeddings.py`, `profile_logic.py`, `schemas.py`) are documented in [ai-ingestion-and-qa.md](./ai-ingestion-and-qa.md); this doc treats them as a boundary.

---

## 5. Where data lives

RIVR spreads state across three stores, each with a clear role.

### 5.1 PostgreSQL (relational + vectors)

`DATABASE_URL` (default `postgres://rivr:rivr@localhost:5432/rivr`; compose maps host `5433:5432`). The image is `pgvector/pgvector:pg16` — **Postgres is mandatory** (ArrayField + pgvector are Postgres-only). The `vector` extension is installed by migration `apps/jobs/migrations/0003_vector_extension.py` (`pgvector.django.VectorExtension()`).

Tables by app (full schema in [data-model-and-flows.md](./data-model-and-flows.md)):

| App | Key tables (`db_table`) |
|---|---|
| accounts | `users` |
| profiles | `user_profiles` |
| documents | `documents` |
| timeline | `timeline_events` |
| jobs | `ai_jobs`, `ai_job_events`, `embeddings` |
| health | `health_profiles`, `health_evaluations` |
| shares | `share_packages` |

All app models inherit from `apps/common/models.py`: `UUIDModel` (uuid4 PK), `TimeStampedModel` (`created_at`/`updated_at`), and `BaseModel = UUIDModel + TimeStampedModel`. UUID PKs everywhere matter for the object-storage prefixes (`documents/{user_id}/...`, `avatars/{user_id}/...`) and the base64-uid password-reset path.

### 5.2 The vector index (pgvector)

The Q&A index is **not** a separate vector DB — it is a Postgres table, `embeddings`, with a pgvector column and an HNSW index:

```python
# apps/jobs/models.py (Embedding)
vector = VectorField(dimensions=768)
# Meta.indexes:
HnswIndex(name="emb_vec_hnsw", fields=["vector"], m=16,
          ef_construction=64, opclasses=["vector_cosine_ops"])
Index(fields=["user"])
```

Each `Embedding` row has `user`, optional `document`, a `kind` (`doc_chunk` \| `fact` \| `timeline`), `content` text, and the 768-d `vector`. Writes go through `index.reindex_document(doc, text=...)`; reads through `index.search(user, query, k=12)` which orders by `pgvector.django.CosineDistance` and is **user-scoped**:

```python
# apps/jobs/index.py
qvec = embeddings.embed([query], query=True)
return list(
    Embedding.objects.filter(user=user).order_by(CosineDistance("vector", qvec[0]))[:k]
)
```

> **Hard coupling:** the column is `dimensions=768`, and `EMBEDDING_DIM` defaults to `768`, but those are **decoupled** — changing the `EMBEDDING_DIM` env (or the embedding model's output dimension) does **not** migrate the column. A different-dimension model requires a schema migration.

### 5.3 Object storage (files)

The storage abstraction is `apps/common/storage.py`, layered over Django `default_storage`:

- **Default backend** is `FileSystemStorage` (`MEDIA_ROOT = backend/media`).
- It switches to `storages.backends.s3.S3Storage` **only when `AWS_ACCESS_KEY_ID` is set** (`base.py:118-125`). When active, MinIO-tuned flags apply: `AWS_S3_ADDRESSING_STYLE="path"`, `AWS_QUERYSTRING_AUTH=True`, `AWS_QUERYSTRING_EXPIRE=600` (10-min signed URLs), `AWS_DEFAULT_ACL=None`, `AWS_S3_FILE_OVERWRITE=False`.
- Tests use `InMemoryStorage`.

Single bucket (`AWS_STORAGE_BUCKET_NAME`, default `rivr-media`), domain-prefixed key layout:

| Prefix | Written by | Contents |
|---|---|---|
| `documents/{user_id}/{kind}/{uuid}_{name}` | upload | the raw uploaded blob (`Document.pdf_path`) |
| `documents/{user_id}/processed/{doc_id}/summary.json` | pipeline | per-doc extracted facts (`Document.summary_path`) |
| `documents/{user_id}/ai/evaluation/latest.json` | pipeline | latest health evaluation |
| `avatars/{user_id}/avatar.jpg` | avatar upload | 512×512 JPEG (re-encoded, EXIF stripped) |
| `share-artifacts/{uuid}/{type}.pdf` | share create | generated share PDFs |

Access to private objects is via **presigned URLs**: `storage.signed_url(key, expire=...)` calls `default_storage.url(key, expire=...)` and falls back to `default_storage.url(key)` on `TypeError` (FileSystemStorage doesn't accept `expire`). The mobile client never sees raw keys for protected reads — it requests a signed URL (e.g. `GET /api/documents/{pk}/file/`, `GET /api/profile/avatar`).

> **MinIO file-URL caveat:** there is no `AWS_S3_CUSTOM_DOMAIN` override, so signed URLs point at the internal endpoint (`AWS_S3_ENDPOINT_URL=http://minio:9000`), which is unreachable from a physical device/host. This is a known local-dev limitation (see [build-deploy-infra.md](./build-deploy-infra.md)).

### 5.4 Redis

Redis 7 (`redis:7`, `6379:6379`) serves two Celery roles: the **broker** (`redis://...:6379/0`) and the **result backend** (`redis://...:6379/1`). It holds no domain data — all durable state is in Postgres.

---

## 6. Where AI runs

All AI calls are made through the OpenAI Python SDK shape (`from openai import OpenAI`), via `apps/jobs/ai_client.py` and `apps/jobs/embeddings.py`. They run in **two places**:

1. **In the Celery worker** (asynchronous) — during `process_documents` and `profile_evaluation`: fact extraction, OCR, audio transcription, document embeddings, and the health evaluation.
2. **In the web process** (synchronous) — only the RAG **Q&A** endpoint, which embeds the query and answers interactively.

Model configuration (`base.py:182-199`):

| Env var | Default | Role |
|---|---|---|
| `OPENAI_API_KEY` | `""` | gates AI; empty → Q&A returns 503 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | |
| `AI_MODEL_EXTRACT` | `gpt-4o-2024-08-06` | document fact extraction |
| `AI_MODEL_EVAL` | `gpt-4o-2024-08-06` | health evaluation; also Q&A fallback |
| `AI_MODEL_OCR` | `gpt-4o-mini` | vision OCR of scanned pages |
| `AI_MODEL_TRANSCRIBE` | `whisper-1` | voice-note transcription (25 MB limit) |
| `AI_MODEL_QUESTION_ANSWER` | `""` | Q&A model; empty → falls back to `AI_MODEL_EVAL` |
| `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` | (default to the OpenAI ones) | embeddings can target a separate endpoint |
| `EMBEDDING_MODEL` | `nomic-embed-text-v1.5` | 768-d embeddings (Nomic `search_query:` / `search_document:` task prefixes) |
| `EMBEDDING_DIM` | `768` | must match the `Embedding.vector` column |
| `OCR_MIN_IMAGE_PX` / `OCR_BATCH_SIZE` | `100` / `10` | OCR tuning |

The separate `EMBEDDING_BASE_URL`/`EMBEDDING_API_KEY` and the Nomic default indicate embeddings are intended to run against an OpenAI-compatible (self-hosted/alternate) endpoint, while chat/vision/audio default to OpenAI. Structured outputs use the OpenAI **Responses API** with pydantic `text_format` schemas (`apps/jobs/schemas.py`). Full prompt and schema detail: [ai-ingestion-and-qa.md](./ai-ingestion-and-qa.md).

### 6.1 Health Q&A / RAG flow

`POST /api/qa` (`apps/health/qa_views.py`) is the one synchronous AI path:

```mermaid
sequenceDiagram
    participant App
    participant API as QAView (web)
    participant EMB as Embeddings endpoint
    participant PG as Postgres (embeddings)
    participant AI as OpenAI (answer)

    App->>API: POST /api/qa {question}
    API->>API: 400 if empty · 503 if OPENAI_API_KEY unset
    API->>EMB: embed(query)  (build_qa_context → index.search)
    EMB-->>API: query vector
    API->>PG: top-12 user-scoped Embeddings (CosineDistance)
    PG-->>API: nearest records
    Note over API: prepend HealthProfile summary +<br/>append recent non-apple_health timeline slice<br/>(cap 30000 chars)
    API->>AI: answer_health_question(question, context)
    AI-->>API: {answer, sources}  (QAAnswer schema)
    API-->>App: 200 {answer, sources}
```

Two important architectural behaviors:

- **Graceful degradation:** if `index.search` throws (e.g. the embeddings endpoint is down), `build_qa_context` silently falls back to `_static_qa_context` — a non-vector slice of the health summary, up to 12 processed documents' `key_facts`, and the recent timeline — and returns empty sources. Q&A keeps working without vector search.
- **Constrained answering:** the system prompt restricts the model to *only* the supplied context (no diagnosis/prescription) and to return an empty sources list when the answer is not present.

---

## 7. Share-link generation (the public artifact path)

Sharing produces **time- and view-limited public links** to generated PDFs, resolvable without an account. This is the only flow that crosses the auth boundary, so it is security-hardened. Logic lives in `apps/shares/services.py` (PDFs via `apps/shares/pdf.py`, reportlab).

```mermaid
sequenceDiagram
    autonumber
    participant App
    participant API as CreateShareView (web, auth)
    participant OBJ as Object storage
    participant DB as Postgres (share_packages)
    participant Web as Next.js /share (public)
    participant RV as ResolveShareView (web, AllowAny)

    App->>API: POST /api/shares {shareTypes, pin?}
    loop each share type
        API->>OBJ: build_pdf(type, user) → share-artifacts/{uuid}/{type}.pdf
    end
    API->>API: token = secrets.token_urlsafe(32)
    API->>DB: SharePackage(token_hash=sha256(token),<br/>expires_at=now+1min, max_views=2,<br/>pin_hash=sha256(pin)?)
    API-->>App: 201 {shareUrl=SHARE_PUBLIC_URL?token=..., expiresAt}

    Note over App: deliver shareUrl (QR / share sheet)

    Web->>RV: POST /api/shares/resolve {token, pin?}
    RV->>DB: lookup by sha256(token)
    alt revoked / not found
        RV-->>Web: 404
    else expired
        RV->>OBJ: purge artifacts (first resolve after expiry)
        RV-->>Web: 410
    else pin required / wrong
        RV-->>Web: 401 (or 429 after 5 attempts)
    else view cap reached
        RV-->>Web: 410
    else ok
        RV->>DB: views_count += 1
        RV->>OBJ: signed_url(pdf, expire=120)
        RV-->>Web: 200 {items:[{title, signedUrl, expiresIn:120}]}
    end
```

Security properties, all server-enforced and not client-overridable:

- The raw token exists **once** (`secrets.token_urlsafe(32)`, returned in the create response). Only `sha256(token)` is persisted (`SharePackage.token_hash`, unique-indexed). PINs are likewise stored only as `sha256(pin)` and compared with `secrets.compare_digest` (constant-time).
- Defaults are aggressive: `SHARE_EXPIRES_MINUTES=1`, `SHARE_MAX_VIEWS=2`, `SHARE_MAX_PIN_ATTEMPTS=5`.
- `resolve_share` returns a dict carrying a `status` key that `ResolveShareView` pops to set the HTTP status (404/410/429/401/200). Artifacts are purged from storage on the first resolve after expiry.
- The resolve endpoint is `AllowAny` but throttled at `share_resolve: 30/min` (`ScopedRateThrottle`).
- There is **no list/delete/revoke API** for shares; `revoked` is admin-only.

The public consumer is the Next.js `/share?token=...` page (`web/app/share/page.tsx`), which calls `POST /api/shares/resolve` directly and renders signed PDF links. See [web-app.md](./web-app.md).

---

## 8. End-to-end picture: from upload to a health score

Putting the major flows together, the canonical "happy path" spans both process roles and all three stores:

```
Mobile upload ──► web process ──► object storage (blob) + Postgres (Document=uploaded)
      │
      └─ enqueue ──► web process ──► Postgres (AiJob=queued, docs=processing) ──► Redis (task)
                                                                                    │
Redis ──► Celery worker ──► pipeline.run_job ───────────────────────────────────────┘
   per document:  read blob ──► extract/OCR/transcribe (OpenAI) ──► facts
                  write summary.json (object storage)
                  replace document_ai TimelineEvents (Postgres)
                  reindex Embeddings (Embeddings endpoint → pgvector)
   shared tail:   build facts digest + Apple-Health snapshot + manual profile
                  evaluate_user_health (OpenAI) ──► HealthEvaluation (append) + HealthProfile (upsert)
                  write evaluation latest.json (object storage)
   finish:        AiJob=succeeded, docs=processed
      │
Mobile polls ai-jobs / documents ──► reads HealthProfile (score, 3×5 card, summary)
                                   ──► syncs Emergency Card to iOS widget
                                   ──► RAG Q&A over the new Embeddings
```

The `HealthProfile` (`db_table="health_profiles"`, user is the PK) is **read-only via the API** (`GET /api/health-profile`) — it is written exclusively by the worker. `GET /api/health-profile` 404s until the first evaluation completes. The data-model-level trace of this flow, including the facts-digest caching and AI backfill, is in [data-model-and-flows.md](./data-model-and-flows.md), and the AI step internals are in [ai-ingestion-and-qa.md](./ai-ingestion-and-qa.md).

---

## 9. Architectural invariants & gotchas (quick reference)

| # | Invariant / gotcha | Where |
|---|---|---|
| 1 | **Upload ≠ processing** — no signals; the client must explicitly `POST /api/jobs/enqueue`. | `apps/documents/views.py`, `apps/jobs/views.py` |
| 2 | **Task dispatch is on transaction commit** so the worker only sees committed job/doc rows. | `apps/jobs/views.py:59` |
| 3 | **Enqueue is deduped** (Postgres array `__overlap`); reused jobs are not re-dispatched. | `apps/jobs/services.py` |
| 4 | **Job state is the source of truth for the UI**, not the Celery result backend; clients poll `ai_jobs`. | `apps/jobs/models.py` |
| 5 | **Cancellation is cooperative** — a flag the pipeline polls, not a hard kill. | `apps/jobs/pipeline.py` |
| 6 | **Stale recovery** auto-fails RUNNING jobs idle >30 min (beat every 5 min). | `pipeline.recover_stale_jobs` |
| 7 | **AI runs in the worker**, except the synchronous Q&A endpoint. | `apps/jobs/*`, `apps/health/qa_views.py` |
| 8 | **pgvector is the vector DB** — `embeddings` table, HNSW cosine, user-scoped. | `apps/jobs/index.py` |
| 9 | **`EMBEDDING_DIM` ≠ the DB column** — changing it doesn't migrate the 768-d `VectorField`. | `apps/jobs/embeddings.py`, `models.py` |
| 10 | **Private object access is via short-lived signed URLs**; MinIO URLs use the internal endpoint (device-unreachable). | `apps/common/storage.py` |
| 11 | **`HealthProfile` is API-read-only** and 404s until the worker writes it. | `apps/health/views.py` |
| 12 | **Share links** store only `sha256(token)`/`sha256(pin)`; 1-min / 2-view / 5-PIN-attempt caps; only `resolve` is public (throttled). | `apps/shares/services.py` |
| 13 | **No `config.settings.prod`** — gunicorn defaults to `dev` (`DEBUG=True`, CORS-all) unless `DJANGO_SETTINGS_MODULE` is overridden. | `config/settings/`, `config/wsgi.py` |
| 14 | **Email verification is not enforced**, and password change/reset does not revoke issued JWTs. | `apps/accounts/views.py` |

For deployment topology, the `./dev` launcher, Docker images, and EAS build profiles, continue to [build-deploy-infra.md](./build-deploy-infra.md). For the exact dependency versions referenced throughout this document, see [tech-stack.md](./tech-stack.md).
