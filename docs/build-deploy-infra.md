# Build, Deploy & Infrastructure

> Runbook-style operational reference for the RIVR Health AI monorepo. Covers the backend Docker stack, gunicorn/whitenoise serving, Postgres+pgvector, MinIO/S3 object storage, Redis, Celery worker/beat, the consolidated environment-variable table, the `./dev` launcher, EAS build profiles, Expo config plugins, the iOS widget target, native entitlements/permissions, helper scripts, and the test setup.

This document is part of the RIVR documentation set. For non-infra detail, link out rather than duplicate:

- [Documentation Index & System Overview](./README.md)
- [Architecture Overview](./architecture-overview.md)
- [Backend Services (Django / DRF / Celery)](./backend-services.md)
- [AI Document Ingestion Pipeline & RAG Q&A](./ai-ingestion-and-qa.md)
- [Mobile App (Expo / React Native)](./mobile-app.md)
- [Web App (Next.js)](./web-app.md)
- [Data Model & End-to-End Flows](./data-model-and-flows.md)
- [Technology Stack Reference](./tech-stack.md)

---

## 1. Repository topology

The monorepo holds three independently-built deliverables plus shared native config. Each has its own dependency tree.

```
RIVR-Health-AI/
├── backend/            Django 5.1 / DRF / Celery API + worker (Python, Docker)
│   ├── config/         Django project package (settings, urls, wsgi/asgi, celery)
│   ├── apps/           Local Django apps (accounts, profiles, documents, …)
│   ├── Dockerfile      python:3.12-slim image (API + worker + beat)
│   ├── docker-compose.yml          Base local stack
│   ├── docker-compose.local.yml    Port-coexistence override (gitignored)
│   ├── requirements.txt / requirements-dev.txt
│   ├── pytest.ini / conftest.py
│   └── .env / .env.example
├── src/                Expo / React Native mobile app (TypeScript)
├── web/                Next.js 15 public web app (separate npm package)
├── targets/widget/     iOS WidgetKit "Emergency Card" target (Swift)
├── plugins/            Local Expo config plugins
├── ios/ android/       Prebuilt native projects
├── scripts/            Dev/fixture helper scripts (Node)
├── app.json            Expo app config (plugins, entitlements, permissions)
├── eas.json            EAS build/submit profiles
├── package.json        Root Expo app package (vitest, expo scripts)
└── dev                 Bash launcher for the whole local stack
```

Two separate Node dependency trees exist: the root Expo app (`package.json` / root `node_modules`) and `web/` (`web/package.json` / `web/node_modules`). The backend is Python-only. The `./dev` script installs each independently. See [Architecture Overview](./architecture-overview.md) for how these pieces interact at runtime.

---

## 2. Backend service architecture

### 2.1 Process model

The backend is one Docker image (`backend/Dockerfile`) run as **three logical processes** sharing the same code, env, and bind-mounted volume:

```
                 ┌──────────────────────────────────────────────┐
                 │              backend/ image                  │
                 │          (python:3.12-slim, /app)            │
                 └──────────────────────────────────────────────┘
                        │              │               │
              ┌─────────┘     ┌────────┘      ┌─────────┘
              ▼               ▼               ▼
      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
      │  web (API)   │ │   worker     │ │    beat      │
      │ runserver /  │ │ celery -A    │ │ celery -A    │
      │ gunicorn     │ │ config worker│ │ config beat  │
      │ :8000        │ │ -l info      │ │ -l info      │
      └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
             │                │                │
   ┌─────────┼────────────────┼────────────────┼─────────┐
   ▼         ▼                ▼                ▼         ▼
┌──────┐ ┌───────┐       ┌───────┐        ┌───────┐ ┌────────┐
│ db   │ │ redis │       │ redis │        │ redis │ │ minio  │
│ pg16 │ │ broker│       │broker │        │broker │ │  S3    │
│pgvec │ │  /0   │       │  /0   │        │  /0   │ │rivr-   │
└──────┘ │result │       └───────┘        └───────┘ │ media  │
         │  /1   │                                   └────────┘
         └───────┘
```

| Process | Compose service | Command | Serves |
|---|---|---|---|
| API | `web` | `python manage.py migrate && python manage.py runserver 0.0.0.0:8000` (compose) / `gunicorn config.wsgi:application --bind 0.0.0.0:8000` (Dockerfile `CMD`) | HTTP/REST on `:8000` |
| Worker | `worker` | `celery -A config worker -l info` | Async pipeline jobs |
| Beat | `beat` | `celery -A config beat -l info` | Scheduled tasks (stale-job recovery every 5 min) |

> **Compose vs. image gotcha.** The Docker `CMD` is `gunicorn config.wsgi:application` (`backend/Dockerfile:19`), but `docker-compose.yml` **overrides** the `web` command to `runserver` (`backend/docker-compose.yml:48-50`). Locally you get the dev server + auto-migrate; the bare image (e.g. a non-compose deploy) runs gunicorn instead and does **not** run migrations.

### 2.2 Django project package (`config/`)

The project package is `config/` (not named after any app). Entry points and their settings defaults:

| File | Purpose | Default `DJANGO_SETTINGS_MODULE` |
|---|---|---|
| `backend/manage.py:8` | CLI entrypoint | `config.settings.dev` |
| `backend/config/wsgi.py:5` | WSGI app (gunicorn) | `config.settings.dev` |
| `backend/config/asgi.py:5` | ASGI app | `config.settings.dev` |
| `backend/config/celery.py:5` | Celery app (`Celery("rivr")`) | `config.settings.dev` |
| `backend/pytest.ini:2` | Test runner | `config.settings.test` |

`config/__init__.py` re-exports `celery_app` so `@shared_task` autodiscovery works at Django startup. `config/celery.py` does `config_from_object("django.conf:settings", namespace="CELERY")` + `autodiscover_tasks()`.

> **No production settings module.** There is no `config.settings.prod`. Unless `DJANGO_SETTINGS_MODULE` is overridden in the environment, **all processes (including gunicorn) run `config.settings.dev`**, which sets `DEBUG = True` and defaults `CORS_ALLOW_ALL_ORIGINS = True`. A real deployment must set `DJANGO_SETTINGS_MODULE` and the security-sensitive env vars (`DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS`, `CORS_*`) explicitly.

### 2.3 Settings split (`backend/config/settings/`)

| Module | Contents |
|---|---|
| `base.py` | The real settings. Reads env via `django-environ` and explicitly loads `BASE_DIR/.env` (`environ.Env.read_env(BASE_DIR / ".env")`, `base.py:14`) where `BASE_DIR` resolves to `backend/`. So `backend/.env` is **always** read, on top of whatever compose injects via `env_file`. |
| `dev.py` | `from .base import *` then `DEBUG = True`. |
| `test.py` | `from .base import *` then: `DEBUG=False`, `CELERY_TASK_ALWAYS_EAGER=True`, MD5 password hasher (fast), `EMAIL_BACKEND=locmem`, strips whitenoise from `MIDDLEWARE`, swaps `STORAGES["default"]` to `InMemoryStorage`, and raises the `share_resolve` throttle to `1000/min`. Tests still hit **real Postgres** (pgvector / `ArrayField` are Postgres-only). |
| `__init__.py` | Empty. |

### 2.4 Installed apps, middleware, DRF, auth

These are detailed in [Backend Services](./backend-services.md); the infra-relevant facts:

- **Middleware order** (`base.py:48-58`): `CorsMiddleware` → `SecurityMiddleware` → **`WhiteNoiseMiddleware`** → Session → Common → Csrf → Authentication → Message → XFrameOptions. CORS is first (correct); whitenoise sits right after security.
- **Static files** served by **whitenoise** (`whitenoise>=6.8,<7`). `STATIC_URL="static/"`, `STATIC_ROOT=backend/staticfiles`. Run `python manage.py collectstatic` before serving via gunicorn in a non-DEBUG deploy.
- **DRF**: JWT auth (`rest_framework_simplejwt`), `IsAuthenticated` default permission, `LimitOffsetPagination` (`PAGE_SIZE=30`), `DjangoFilterBackend`+`OrderingFilter`, `ScopedRateThrottle` with `{"share_resolve": "30/min"}`.
- **OpenAPI**: `drf-spectacular` schema at `/api/schema/`, Swagger UI at `/api/docs/` (`config/urls.py:16-17`). Title `RIVR API`, version `0.1.0`.

### 2.5 Operational URLs

| Path | Name | Notes |
|---|---|---|
| `/healthz` | `healthz` | Inline `JsonResponse({"status":"ok"})`. **No trailing slash.** Cheap liveness probe. |
| `/api/schema/` | `schema` | OpenAPI schema. Used by `./dev wait_for_api` as the readiness check. |
| `/api/docs/` | `docs` | Swagger UI. |
| `/admin/` | — | Django admin. |
| `/api/account` | `delete-account` | Account deletion. **No trailing slash** (distinct from the `/api/auth/` include). |

> **Trailing-slash inconsistency.** `/healthz` and `/api/account` have no trailing slash; most `/api/...` resource paths do. Mobile/web clients must match this per-endpoint (see [Mobile App](./mobile-app.md) and [Web App](./web-app.md)).

---

## 3. Datastores & object storage

### 3.1 Postgres + pgvector

| Aspect | Value |
|---|---|
| Image | `pgvector/pgvector:pg16` (Postgres 16 + pgvector) |
| Driver | `psycopg[binary]>=3.2,<4` |
| Setting | `DATABASES["default"] = env.db("DATABASE_URL", default="postgres://rivr:rivr@localhost:5432/rivr")` (`base.py:80-82`) |
| Compose DSN | `postgres://rivr:rivr@db:5432/rivr` (service hostname `db`) |
| Host port | **`5433:5432`** — host `5433` to avoid clashing with a local Postgres on `5432` |
| Volume | `pgdata` |
| Healthcheck | `pg_isready -U rivr` (5s interval / 3s timeout / 10 retries) |

The `vector` extension is installed by migration `backend/apps/jobs/migrations/0003_vector_extension.py`, which runs `pgvector.django.VectorExtension()`.

**Vector column & index** (`backend/apps/jobs/models.py`, `db_table="embeddings"`):

```python
vector = VectorField(dimensions=768)                       # models.py:83
HnswIndex(name="emb_vec_hnsw", fields=["vector"],          # models.py:88-89
          m=16, ef_construction=64,
          opclasses=["vector_cosine_ops"])                 # cosine ANN
```

Queries use `pgvector.django.CosineDistance` in `backend/apps/jobs/index.py`. See [AI Ingestion & Q&A](./ai-ingestion-and-qa.md) for retrieval internals.

> **Embedding dimension is hard-coupled.** `EMBEDDING_DIM` (env, default `768`) is **decoupled** from both the module constant `EMBEDDING_DIM = 768` in `backend/apps/jobs/embeddings.py:4` and the `VectorField(dimensions=768)` DB column. Changing the env var alone does **not** migrate the column — switching embedding models to a different dimension requires a schema migration.

### 3.2 Object storage (S3 / MinIO)

Default `STORAGES["default"]` is `FileSystemStorage` (`MEDIA_ROOT=backend/media`). It is **conditionally swapped** to `storages.backends.s3.S3Storage` only when `AWS_ACCESS_KEY_ID` is set (`base.py:107-125`).

When S3 is active, MinIO-tuned flags are applied (`base.py:118-125`):

| Flag | Value | Meaning |
|---|---|---|
| `AWS_S3_ADDRESSING_STYLE` | `"path"` | MinIO requires path-style |
| `AWS_QUERYSTRING_AUTH` | `True` | Signed/presigned URLs |
| `AWS_QUERYSTRING_EXPIRE` | `600` | 10-minute URL expiry |
| `AWS_DEFAULT_ACL` | `None` | Objects private |
| `AWS_S3_FILE_OVERWRITE` | `False` | No silent overwrites |

**MinIO compose services:**

| Service | Image | Details |
|---|---|---|
| `minio` | `minio/minio` | `server /data --console-address ":9001"`; root user `rivr-minio` / `rivr-minio-secret`; ports `9000:9000` (API), `9001:9001` (console); volume `miniodata` |
| `createbuckets` | `minio/mc` | One-shot: `mc alias set local`, `mc mb -p local/rivr-media`, `mc anonymous set none local/rivr-media` (private bucket), `exit 0` |

Storage helpers live in `backend/apps/common/storage.py` (single bucket, domain-prefixed keys: `documents/{user_id}/{kind}/...`, `documents/{user_id}/processed/{doc_id}/summary.json`, `documents/{user_id}/ai/evaluation/latest.json`, `avatars/{user_id}/avatar.jpg`, `share-artifacts/{uuid}/{type}.pdf`). Detailed in [Data Model & Flows](./data-model-and-flows.md).

> **MinIO file-URL caveat (known issue).** `AWS_S3_ENDPOINT_URL` is `http://minio:9000` (the compose-internal hostname) and there is no `AWS_S3_CUSTOM_DOMAIN`/protocol override. Presigned URLs therefore point at `http://minio:9000/...`, which is **only resolvable inside the Docker network** — unreachable from a phone or the host browser. This is the documented limitation behind file-download failures on real devices in local dev.

### 3.3 Redis (broker + result backend)

| Service | Image | Ports | Used for |
|---|---|---|---|
| `redis` | `redis:7` | `6379:6379` | Celery broker (DB `/0`) and result backend (DB `/1`) |

`CELERY_BROKER_URL` default `redis://localhost:6379/0`; `CELERY_RESULT_BACKEND` default `redis://localhost:6379/1` (compose `.env` uses the `redis` hostname). DB 0 = broker, DB 1 = results.

### 3.4 Mailpit (local SMTP)

| Service | Image | Ports | Used for |
|---|---|---|---|
| `mailpit` | `axllent/mailpit` | `1025:1025` (SMTP), `8025:8025` (web UI) | Catches verification/reset emails locally |

`EMAIL_HOST=localhost` / `EMAIL_PORT=1025` by default; compose `.env` sets `EMAIL_HOST=mailpit`. No `EMAIL_HOST_USER`/`EMAIL_USE_TLS` in base — local dev assumes an open relay. Tests override to `locmem`. Email is fail-silent in app code (see [Backend Services](./backend-services.md)).

---

## 4. Celery (async pipeline)

```
EnqueueView (POST /api/jobs/enqueue)
   │  transaction.on_commit(...)
   ▼
celery_app.send_task("apps.jobs.tasks.process_documents_task" | "...profile_evaluation_task", args=[job_id])
   │
   ▼  Redis broker (/0)
worker  ──►  pipeline.run_job(job_id)  ──►  result backend (/1)

beat  ──every 300s──►  apps.jobs.tasks.recover_stale_jobs_task  ──►  pipeline.recover_stale_jobs()
```

| Setting | Default | Notes |
|---|---|---|
| `CELERY_BROKER_URL` | `redis://localhost:6379/0` | |
| `CELERY_RESULT_BACKEND` | `redis://localhost:6379/1` | |
| `CELERY_TASK_ALWAYS_EAGER` | `False` (env), **`True`** in `test.py` | Eager = run inline (no broker) for tests |
| `CELERY_TASK_TRACK_STARTED` | `True` | |
| `CELERY_BEAT_SCHEDULE` | `{"recover-stale-jobs": {"task": "apps.jobs.tasks.recover_stale_jobs_task", "schedule": 300.0}}` | Every 5 min |

Three `@shared_task`s in `backend/apps/jobs/tasks.py`: `process_documents_task`, `profile_evaluation_task` (both call `pipeline.run_job`), and `recover_stale_jobs_task` (beat-driven; the stale cutoff is **30 min** of no `updated_at` movement, hardcoded in `recover_stale_jobs`, vs. the 5-min beat interval). Job lifecycle, dedupe, cancellation, and stage/heartbeat bookkeeping are documented in [Backend Services](./backend-services.md) and [AI Ingestion & Q&A](./ai-ingestion-and-qa.md).

---

## 5. Consolidated environment variables

All backend env vars are read in `backend/config/settings/base.py` via `django-environ`. The committed `backend/.env.example` is the canonical local template; `backend/.env` (gitignored, present only in the local working tree — not committed) layers on top and is **always** read by `base.py`. Frontend vars use the `EXPO_PUBLIC_` / `NEXT_PUBLIC_` prefixes (inlined into client bundles — treat as **public, not secret**).

### 5.1 Backend — core / Django

| Variable | Used by | Purpose | Default |
|---|---|---|---|
| `DJANGO_SECRET_KEY` | `base.py:17` | Django secret key | `dev-insecure-change-me-...` (dev only) |
| `DJANGO_DEBUG` | `base.py:21` | Debug mode | `True` |
| `DJANGO_ALLOWED_HOSTS` | `base.py:22` | Allowed Host header list | `["*"]` |
| `DATABASE_URL` | `base.py:81` | Postgres DSN | `postgres://rivr:rivr@localhost:5432/rivr` (compose: `...@db:5432/...`) |
| `CORS_ALLOW_ALL_ORIGINS` | `base.py:161` | Allow any CORS origin | `True` |
| `CORS_ALLOWED_ORIGINS` | `base.py:162` | Explicit CORS allowlist | `[]` |

### 5.2 Backend — Celery / Redis

| Variable | Used by | Purpose | Default |
|---|---|---|---|
| `CELERY_BROKER_URL` | `base.py:165` | Broker | `redis://localhost:6379/0` |
| `CELERY_RESULT_BACKEND` | `base.py:166` | Result backend | `redis://localhost:6379/1` |
| `CELERY_TASK_ALWAYS_EAGER` | `base.py:167` | Run tasks inline | `False` (True in tests) |

### 5.3 Backend — object storage (S3 / MinIO)

| Variable | Used by | Purpose | Default |
|---|---|---|---|
| `AWS_ACCESS_KEY_ID` | `base.py:112` | S3 key; **presence flips storage to S3** | `""` |
| `AWS_SECRET_ACCESS_KEY` | `base.py:113` | S3 secret | `""` |
| `AWS_STORAGE_BUCKET_NAME` | `base.py:114` | Bucket | `rivr-media` |
| `AWS_S3_ENDPOINT_URL` | `base.py:115` | S3/MinIO endpoint | `""` (compose: `http://minio:9000`) |
| `AWS_S3_REGION_NAME` | `base.py:116` | Region | `us-east-1` |

### 5.4 Backend — email

| Variable | Used by | Purpose | Default |
|---|---|---|---|
| `EMAIL_BACKEND` | `base.py:177` | Email backend | `django.core.mail.backends.smtp.EmailBackend` |
| `EMAIL_HOST` | `base.py:178` | SMTP host | `localhost` (compose: `mailpit`) |
| `EMAIL_PORT` | `base.py:179` | SMTP port | `1025` |
| `DEFAULT_FROM_EMAIL` | `base.py:180` | From address | `RIVR <no-reply@rivrhealth.local>` |

### 5.5 Backend — OpenAI / AI models

| Variable | Used by | Purpose | Default |
|---|---|---|---|
| `OPENAI_API_KEY` | `base.py:183` | OpenAI key; gates `POST /api/qa` (503 if empty) | `""` |
| `OPENAI_BASE_URL` | `base.py:184` | OpenAI base URL | `https://api.openai.com/v1` |
| `AI_MODEL_EXTRACT` | `base.py:185` | Document fact extraction | `gpt-4o-2024-08-06` |
| `AI_MODEL_EVAL` | `base.py:186` | Health evaluation + Q&A fallback | `gpt-4o-2024-08-06` |
| `AI_MODEL_OCR` | `base.py:187` | Vision OCR | `gpt-4o-mini` |
| `AI_MODEL_TRANSCRIBE` | `base.py:188` | Audio transcription | `whisper-1` |
| `AI_MODEL_QUESTION_ANSWER` | `base.py:189` | Q&A model | `""` → falls back to `AI_MODEL_EVAL` |

### 5.6 Backend — embeddings & OCR ingestion

| Variable | Used by | Purpose | Default |
|---|---|---|---|
| `EMBEDDING_BASE_URL` | `base.py:192` | Embedding endpoint | = `OPENAI_BASE_URL` |
| `EMBEDDING_API_KEY` | `base.py:193` | Embedding key | = `OPENAI_API_KEY` |
| `EMBEDDING_MODEL` | `base.py:194` | Embedding model | `nomic-embed-text-v1.5` |
| `EMBEDDING_DIM` | `base.py:195` | Embedding dimension (must match the 768-dim column) | `768` |
| `OCR_MIN_IMAGE_PX` | `base.py:198` | Skip images smaller than this | `100` |
| `OCR_BATCH_SIZE` | `base.py:199` | OCR images per batch | `10` |

> The embedding defaults (`nomic-embed-text-v1.5`, 768-dim, separate base URL/key) indicate embeddings are intended to run against an OpenAI-compatible **alternate endpoint** (e.g. self-hosted Nomic), even though all calls go through the OpenAI SDK shape.

### 5.7 Backend — frontend / shares

| Variable | Used by | Purpose | Default |
|---|---|---|---|
| `FRONTEND_URL` | `base.py:202` | Base for verify/reset email links | `http://localhost:3000` |
| `SHARE_PUBLIC_URL` | `base.py:203` | Base of returned `shareUrl` | `http://localhost:3000/share` |
| `SHARE_EXPIRES_MINUTES` | `base.py:206` | Share link lifetime | `1` |
| `SHARE_MAX_VIEWS` | `base.py:207` | Share view cap | `2` |
| `SHARE_MAX_PIN_ATTEMPTS` | `base.py:208` | PIN brute-force cap | `5` |

### 5.8 Mobile (Expo) — `.env`

| Variable | Used by | Purpose | Example |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | `src/lib/api/client.ts` (`BASE`), `src/screens/App/ProfileScreen.tsx` | Django API base | `http://localhost:8001` (synced by `./dev`); LAN IP for physical devices |
| `EXPO_PUBLIC_SENTRY_DSN` | `src/lib/sentry.ts` | Sentry DSN (Sentry disabled in `__DEV__`) | `""` |

> Only `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_SENTRY_DSN` are actually referenced in the mobile codebase (verified by grep across `src/`, `app.json`, `eas.json`). No other `EXPO_PUBLIC_*` variable is read.

### 5.9 Web (Next.js) — `web/.env.local`

| Variable | Used by | Purpose | Example |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `web/lib/api.ts` (`BASE`) | Django API base | `http://localhost:8000` (synced by `./dev`) |

### 5.10 Helper scripts only

| Variable | Used by | Purpose |
|---|---|---|
| `VERCEL_OIDC_TOKEN` | `.env.local` (Vercel CI) | Vercel OIDC token (project `rivr-health-ai`, team `rivr-shares-projects`). **Lives in gitignored `.env.local` on disk only — not committed; rotate as a precaution.** |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `scripts/empty-share-artifacts.mjs` | Legacy Supabase storage diagnostic (pre-Django era) |

> **Secrets-on-disk gotchas.** `backend/.env` and `.env.local` are both **gitignored** (`backend/.gitignore:3` ignores `.env`; root `.gitignore:34` ignores `.env*.local`) — `git ls-files` confirms only `backend/.env.example` is tracked, and neither secret file is in version control or git history. They do, however, exist in the local working tree with real values: `backend/.env` holds a real `OPENAI_API_KEY=sk-proj-...` (vs. the blank value in `.env.example`), and `.env.local` holds a real `VERCEL_OIDC_TOKEN` JWT. Because these are local-only artifacts, "remove from VCS" does not apply — but the live OpenAI key and Vercel OIDC token on disk should still be treated as exposed and rotated as a precaution.

---

## 6. Docker Compose reference

### 6.1 Base stack (`backend/docker-compose.yml`, project `name: rivr-backend`)

| Service | Image / build | Host ports | Volumes | Depends on |
|---|---|---|---|---|
| `db` | `pgvector/pgvector:pg16` | `5433:5432` | `pgdata` | — |
| `redis` | `redis:7` | `6379:6379` | — | — |
| `minio` | `minio/minio` | `9000:9000`, `9001:9001` | `miniodata` | — |
| `createbuckets` | `minio/mc` | — | — | `minio` |
| `mailpit` | `axllent/mailpit` | `1025:1025`, `8025:8025` | — | — |
| `web` | `build: .` | `8000:8000` | `./:/app` | `db` (healthy), `redis` (started) |
| `worker` | `build: .` | — | `./:/app` | `db` (healthy), `redis` (started) |
| `beat` | `build: .` | — | `./:/app` | `db` (healthy), `redis` (started) |

All three app services use `env_file: [.env]` and bind-mount the source tree (`./:/app`) so code changes hot-reload. The `web` service runs `migrate` then `runserver` (not gunicorn). Named volumes: `pgdata`, `miniodata`.

### 6.2 Port-coexistence override (`backend/docker-compose.local.yml`)

Gitignored (per `backend/.gitignore:12`) but present in the working tree. Lets the stack coexist with another project already holding host ports `8000`/`6379`, using Compose-Spec merge directives:

```yaml
services:
  redis:
    ports: !reset []          # redis becomes internal-only (reached via the "redis" hostname)
  web:
    ports: !override ["8001:8000"]   # API published on host :8001
```

Apply it explicitly:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

The `./dev` script layers this automatically when the file exists (see §7). This is why the mobile `.env` points at `http://localhost:8001`.

### 6.3 Dockerfile (`backend/Dockerfile`)

```dockerfile
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*               # build deps for psycopg, then clean apt lists
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt   # NOTE: dev deps (pytest etc.) baked into the image
COPY . .
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000"]   # no worker tuning
```

> Notes: (1) the image installs **`requirements-dev.txt`**, so `pytest`, `pytest-django`, `factory-boy`, etc. ship in the runtime image; (2) `gunicorn` has no `--workers`/`--threads` tuning; (3) compose overrides this `CMD` for `web`/`worker`/`beat`.

---

## 7. The `./dev` local launcher

`./dev` (root, `bash`, `set -euo pipefail`) brings up the whole stack with one command and keeps the clients' env in sync with the backend's actual port.

### 7.1 Subcommands

| Command | Action |
|---|---|
| `./dev` / `./dev up` | Backend (Docker, detached) + web (Next.js, background) + mobile (Expo, foreground). An `EXIT` trap stops the background web when Expo exits; **backend keeps running** until `./dev down`. |
| `./dev backend` | Only the backend Docker stack (detached). |
| `./dev web` | Only Next.js (foreground, `:3000`). |
| `./dev mobile` | Only Expo (foreground, `npm start`). |
| `./dev logs` | `docker compose logs -f`. |
| `./dev down` | Stop background web + `docker compose down`. |

### 7.2 What `./dev up` does, in order

```
ensure_backend_env   →  cp backend/.env.example backend/.env if missing; warn if OPENAI_API_KEY blank
COMPOSE_ARGS         →  -f docker-compose.yml  (+ -f docker-compose.local.yml if it exists)
compose up -d --build→  db, redis, minio, mailpit, web(django), worker(celery), beat
api_port()           →  reads `docker compose port web 8000`  (defaults to 8000)
wait_for_api         →  polls http://localhost:<port>/api/schema/  up to 60×2s
sync_client_env      →  upserts NEXT_PUBLIC_API_URL into web/.env.local
                        and EXPO_PUBLIC_API_URL into root .env  (both → http://localhost:<port>)
start_web_bg         →  npm install (if needed) + `npm run dev` in web/  (logs → .dev/web.log, pid → .dev/web.pid)
start_mobile_fg      →  npm install (if needed) + `npm start`; hints LAN IP for physical devices
```

Key mechanics:

- **Working dir `.dev/`** (gitignored) holds `web.log` and `web.pid`.
- **Dynamic API port discovery** (`api_port()`): reads the *actual* published host port of the compose `web` service via `docker compose port web 8000`. This is the :8001-coexistence mechanism — if the local override binds `8001:8000`, the script discovers `8001` and points both clients there.
- **Env bootstrap** (`sync_client_env`): BSD `sed -i ''` upsert of `NEXT_PUBLIC_API_URL` (web) and `EXPO_PUBLIC_API_URL` (mobile) at `http://localhost:<discovered-port>`. This is the seam linking the running backend port to both client bundles.
- **Console output**: prints MinIO console (`:9001`, creds `rivr-minio / rivr-minio-secret`) and Mailpit inbox (`:8025`).
- **Physical-device hint** (`start_mobile_fg`): computes the LAN IP via `ipconfig getifaddr en0/en1` and suggests setting `EXPO_PUBLIC_API_URL=http://<lan-ip>:<port>` in `.env` (a phone can't reach `localhost`). Runs `npm start` as a **child** (no `exec`) so the EXIT trap can clean up.

### 7.3 Quick-start

```bash
./dev                      # full stack: backend + web + mobile
# or piecemeal:
./dev backend              # just Docker (db/redis/minio/mailpit/django/celery/beat)
./dev web                  # Next.js on :3000
./dev logs                 # tail backend logs
./dev down                 # stop background web + docker compose down
```

| Local endpoint | URL |
|---|---|
| API (default / coexistence) | `http://localhost:8000` / `http://localhost:8001` |
| Next.js web | `http://localhost:3000` |
| MinIO console | `http://localhost:9001` (`rivr-minio` / `rivr-minio-secret`) |
| Mailpit inbox | `http://localhost:8025` |
| OpenAPI schema / Swagger | `/api/schema/` · `/api/docs/` |

---

## 8. Mobile build & native config

### 8.1 EAS build / submit profiles (`eas.json`)

`cli.version >= 3.0.0`, `cli.appVersionSource: "remote"` (version managed by EAS).

| Profile | Settings |
|---|---|
| `development` | `developmentClient: true`, `distribution: "internal"`, `ios.simulator: true` |
| `preview` | `distribution: "internal"` |
| `production` | `autoIncrement: true` |

`submit.production.ios`: `appleId "darwashi@udel.edu"`, `ascAppId "6761561666"`, `appleTeamId "NUGFXB4PHG"`.

Root build scripts (`package.json`): `start` = `expo start`, `ios` = `expo run:ios`, `android` = `expo run:android`, `web` = `expo start --web`, `typecheck` = `tsc --noEmit --pretty false`, `test` = `vitest run`, `lint` = `expo lint`. EAS project id `0b17b39a-c1e6-49f9-95e3-71acea501e8f` (`app.json`).

### 8.2 Expo app config (`app.json`)

- `name`/`slug` `RIVR-Health-AI`, `version 1.0.0`, `orientation portrait`, **`scheme "rivrhealth"`** (deep-link prefix), `userInterfaceStyle "automatic"`, **`newArchEnabled: false`**, `owner "darwashiom"`.
- **Plugins (order matters)**:
  1. `expo-image-picker` (photos/camera permission strings)
  2. `expo-font`
  3. `react-native-health` (HealthKit RN bridge)
  4. `expo-build-properties` → `ios.deploymentTarget "15.1"`
  5. `./plugins/with-ios-fmt-xcode-fix` (local plugin, §8.4)
  6. `@bacons/apple-targets` (loads the widget target, §8.5)

### 8.3 iOS entitlements & permissions

| Capability | Source | Value |
|---|---|---|
| HealthKit | `app.json` `ios.entitlements` / `ios/RIVRHealthAI/RIVRHealthAI.entitlements` | `com.apple.developer.healthkit: true`; `com.apple.developer.healthkit.access: <empty array>` (read-only) |
| App Group | same | `com.apple.security.application-groups: ["group.com.rivrhealth.app"]` (shared with widget) |
| Bundle id / team | `app.json` `ios` | `com.rivrhealth.app` / `appleTeamId NUGFXB4PHG` |
| URL schemes | `ios/.../Info.plist` | `rivrhealth`, `com.rivrhealth.app`, Expo-dev `exp+rivr-health-ai` |
| ATS | Info.plist | `NSAllowsArbitraryLoads false`, `NSAllowsLocalNetworking true` (allows `http://localhost` dev API) |

Info.plist usage strings (`app.json` `ios.infoPlist`): `NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `ITSAppUsesNonExemptEncryption: false`. iOS deployment target pinned to `15.1`.

> HealthKit is **read-only** in practice (`READ_PERMISSION_KEYS`, no write scopes — see [Mobile App](./mobile-app.md)), despite `NSHealthUpdateUsageDescription` being declared.

**Android permissions:**

- `app.json` `android.permissions`: `["android.permission.RECORD_AUDIO"]`; `package com.rivrhealth.app`, `edgeToEdgeEnabled`, `predictiveBackGestureEnabled false`.
- Generated `android/app/src/main/AndroidManifest.xml` additionally declares: `INTERNET`, `MODIFY_AUDIO_SETTINGS`, `READ_EXTERNAL_STORAGE`, `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`, `VIBRATE`, `WRITE_EXTERNAL_STORAGE`; deep-link intent-filters for `rivrhealth` and `exp+rivr-health-ai`; expo-updates **disabled**. Debug manifests force `usesCleartextTraffic="true"` for the plain-HTTP dev server.
- `android/app/build.gradle`: `applicationId/namespace com.rivrhealth.app`, `versionCode 1`, `versionName "1.0.0"`. **Release builds reuse the debug keystore** (`signingConfig signingConfigs.debug`) — flagged in-file to replace before production.

### 8.4 Local config plugin (`plugins/with-ios-fmt-xcode-fix.js`)

A `withDangerousMod("ios", …)` plugin that works around **fmt 11.0.2 `consteval` failures on Apple clang**. On prebuild it injects an idempotent (`# RIVR:`-marked) Ruby snippet into the Podfile's `react_native_post_install` block; at pod-install time the Ruby rewrites `Pods/fmt/include/fmt/base.h`, replacing the version-gated guard with an unconditional `#define FMT_USE_CONSTEVAL 0` for any `__apple_build_version__`. It `throw`s if it can't find `react_native_post_install`. The patch is already materialized in the committed `ios/Podfile`. Without it, native iOS builds fail to compile fmt.

### 8.5 iOS widget target (`targets/widget/`)

A WidgetKit "Emergency Card" home-screen widget (Swift), configured by `@bacons/apple-targets 4.0.7`. The Podfile dynamically loads targets via `Dir.glob(.../targets/**/pods.rb)`.

`targets/widget/expo-target.config.js`:

```js
module.exports = (config) => ({
  type: "widget",
  name: "RivrWidget",
  deploymentTarget: "15.1",
  colors: { $accent: "#1FADA6", $widgetBackground: { color: "#FFFFFF", darkColor: "#0D1B2A" } },
  entitlements: {                       // inherits the app's App Group →
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
```

The widget (`EmergencyCardWidget.swift`) reads the App Group `UserDefaults(suiteName: "group.com.rivrhealth.app")` key `emergency_card`, decodes the JSON the RN app writes, and deep-links to `rivrhealth://health-summary` on tap. Timeline policy `.never` (event-driven; refreshed only when the app calls `reloadWidget("RivrWidget")`).

> **Shared constants are a silent seam.** The App Group `group.com.rivrhealth.app`, storage key `emergency_card`, and widget kind `RivrWidget` are hardcoded **identically** in `targets/widget/EmergencyCardWidget.swift` and `src/lib/emergencyCardWidget/sync.ts`. Changing one side without the other silently breaks the widget. See [Mobile App](./mobile-app.md) for the app↔widget bridge.

---

## 9. Web build (`web/`)

A separate Next.js 15 (App Router, React 19) npm package — see [Web App](./web-app.md) for routes and behaviour. Build-relevant facts:

| Aspect | Value |
|---|---|
| Scripts (`web/package.json`) | `dev` = `next dev -p 3000`, `build` = `next build`, `start` = `next start -p 3000`, `lint` = `next lint`, `typecheck` = `tsc --noEmit` |
| Config | `web/next.config.mjs`: `reactStrictMode: true`, `outputFileTracingRoot: __dirname` (pins tracing to `web/` so the adjacent Expo app doesn't confuse standalone tracing) |
| Env | `web/.env.local.example` → only `NEXT_PUBLIC_API_URL=http://localhost:8000`; `./dev` writes the real value into `web/.env.local` |
| Lint | Next's own `next lint` (no separate eslint config in `web/`); the root Expo app uses `eslint.config.js` (flat, `eslint-config-expo/flat`) |

---

## 10. Helper scripts (`scripts/`)

| Script | Type | Purpose |
|---|---|---|
| `scripts/build-health-summary.cjs` | Node CLI (no deps) | Dev/fixture generator. Streams `src/lib/health/export.xml` (an Apple Health export) line-by-line via `readline`, regex-parses `<Record …>` lines, and writes `src/lib/health/export.summary.json` (latest heart rate, 7-day sleep avg, step counts). Exits 1 if `export.xml` missing. Not a real XML parser. |
| `scripts/empty-share-artifacts.mjs` | Node (`@supabase/supabase-js`) | **Read-only diagnostic** despite the name — lists Supabase storage buckets and inspects `share-artifacts`. Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (hard-exits if missing). Leftover from the pre-Django Supabase era; does **not** empty anything currently. |

---

## 11. Test setup

### 11.1 Backend (pytest + pytest-django)

| Aspect | Value |
|---|---|
| Config | `backend/pytest.ini`: `DJANGO_SETTINGS_MODULE = config.settings.test`; `python_files = tests.py test_*.py *_tests.py`; `addopts = -ra --strict-markers` |
| Root fixtures | `backend/conftest.py`: single `api_client` fixture → DRF `APIClient()` |
| Test settings | `config.settings.test` (§2.3): eager Celery, `InMemoryStorage`, MD5 hasher, locmem email, no whitenoise, `share_resolve` throttle `1000/min` |
| Database | **Real Postgres** (pgvector + `ArrayField` are Postgres-only) — needs a running `db` |
| Dev deps | `requirements-dev.txt`: `pytest>=8.3,<9`, `pytest-django>=4.9,<5`, `pytest-cov>=6,<7`, `factory-boy>=3.3,<4` |

Test suite (`backend/tests/`): `test_api`, `test_auth`, `test_embeddings`, `test_extraction`, `test_index`, `test_jobs_enqueue`, `test_models`, `test_pdf_ingestion`, `test_pipeline`, `test_profile_logic`, `test_qa`, `test_shares`, `test_smoke`, `test_storage`.

Run (inside the `web` container or a venv with `db` reachable):

```bash
cd backend
pytest                       # uses config.settings.test
pytest --cov                 # with coverage (pytest-cov)
```

### 11.2 Mobile (vitest)

| Aspect | Value |
|---|---|
| Runner | `vitest ^4.1.6`; root script `test` = `vitest run` |
| Scope | TS logic units, not RN-render tests |

Test files (`src/`): `navigation/linking.test.ts`, `lib/nativePermissions.test.ts`, `lib/share.test.ts`, `lib/mobileKeyboardInputs.test.ts`, `lib/aiQuestionSearch.test.ts`, `lib/timeline.test.ts`, `lib/documentScanFlow.test.ts`, `lib/documentProcessingUi.test.ts`, `lib/health/healthkitPermissions.test.ts`, `lib/api/client.test.ts`, `lib/emergencyCardWidget/mapping.test.ts`.

```bash
npm test                     # vitest run (root)
npm run typecheck            # tsc --noEmit --pretty false
```

The `web/` app exposes its own `typecheck` (`tsc --noEmit`) and `lint` (`next lint`) but has no unit tests.

---

## 12. Dependency inventory

### 12.1 Backend (`backend/requirements.txt`)

| Package | Constraint | Role |
|---|---|---|
| Django | `>=5.1,<5.2` | Web framework |
| djangorestframework | `>=3.15,<3.16` | REST API |
| djangorestframework-simplejwt | `>=5.3,<6` | JWT auth + token blacklist |
| django-environ | `>=0.11,<0.12` | Env config |
| psycopg[binary] | `>=3.2,<4` | Postgres driver |
| celery | `>=5.4,<6` | Async tasks + beat |
| redis | `>=5.2,<6` | Broker/result client |
| django-storages | `>=1.14,<2` | S3/MinIO storage backend |
| boto3 | `>=1.35,<2` | AWS/S3 SDK |
| django-cors-headers | `>=4.6,<5` | CORS |
| django-filter | `>=24.3` | Query filtering |
| drf-spectacular | `>=0.28,<0.29` | OpenAPI schema + Swagger |
| Pillow | `>=11,<12` | Avatar image processing |
| gunicorn | `>=23,<24` | WSGI server |
| whitenoise | `>=6.8,<7` | Static file serving |
| pydantic | `>=2.9,<3` | AI structured-output schemas |
| openai | `>=1.50,<2` | OpenAI SDK |
| pgvector | `>=0.3,<0.4` | Vector column/index/distance |
| PyMuPDF | `>=1.24,<2` | PDF text/image extraction (`fitz`) |
| reportlab | `>=4,<5` | Share-PDF generation |

Dev (`backend/requirements-dev.txt`): `-r requirements.txt` + `pytest>=8.3,<9`, `pytest-django>=4.9,<5`, `pytest-cov>=6,<7`, `factory-boy>=3.3,<4`.

### 12.2 Frontend (notable)

- **Mobile (root `package.json`)**: `expo ~54.0.34`, `react-native 0.81.5`, `react 19.1.0`, `@sentry/react-native ~7.2.0`, `react-native-health ^1.19.0`, `@bacons/apple-targets 4.0.7`, `expo-build-properties ~1.0.10`, `vitest ^4.1.6`. Overrides: `@expo/config-plugins 54.0.4` pinned, `postcss ^8.5.10` under `@expo/metro-config`. `expo.doctor.reactNativeDirectoryCheck.exclude`: `react-native-health`, `react-native-document-picker`.
- **Web (`web/package.json`)**: `next ^15.5.19`, `react 19.0.0`, `react-dom 19.0.0`, `typescript 5.7.3`, `tailwindcss 3.4.17`.

Full version matrix in [Technology Stack Reference](./tech-stack.md).

---

## 13. Operational gotchas (consolidated)

| # | Gotcha |
|---|---|
| 1 | **No prod settings module.** wsgi/gunicorn default to `config.settings.dev` (`DEBUG=True`, `CORS_ALLOW_ALL_ORIGINS=True`) unless `DJANGO_SETTINGS_MODULE` + security env vars are overridden. |
| 2 | **Secrets on disk (not in VCS).** `backend/.env` (real OpenAI key) and `.env.local` (real Vercel OIDC token) are both gitignored and live only in the local working tree — not committed, not in git history. Rotate the on-disk keys as a precaution. |
| 3 | **`EMBEDDING_DIM` is decoupled** from the hardcoded `768` in `embeddings.py:4` and the `VectorField(dimensions=768)` column — changing the env won't migrate the DB. |
| 4 | **MinIO signed URLs use `http://minio:9000`** (internal) with no custom-domain override — unreachable from a device/host browser. |
| 5 | **Dockerfile bakes dev requirements** (pytest etc.) into the runtime image. |
| 6 | **Compose `web` runs `runserver`, not gunicorn**, and auto-migrates; the bare image runs gunicorn and does not migrate. |
| 7 | **`docker-compose.local.yml` is gitignored** and not auto-merged by raw `docker compose` — pass it with `-f` (or use `./dev`, which layers it when present). |
| 8 | **`healthz` and `api/account` have no trailing slash**; most other API paths do. |
| 9 | **Tests need a real Postgres** (pgvector/ArrayField); only storage/email/Celery/hasher are faked. |
| 10 | **Android release builds reuse the debug keystore** — replace before production submission. |
| 11 | **Stale-job recovery cutoff (30 min) vs. beat interval (5 min)** — a crashed worker's RUNNING job is auto-failed and its docs reverted to UPLOADED for retry. |
| 12 | **Widget App-Group/key/kind constants are duplicated** in Swift and TS — keep `group.com.rivrhealth.app` / `emergency_card` / `RivrWidget` in sync. |
