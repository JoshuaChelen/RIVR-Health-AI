# RIVR — Supabase → Django API Migration (Design Spec)

**Date:** 2026-06-08
**Status:** Approved direction; phased build in progress
**Branch:** `feat/django-backend-migration`

## 1. Goal & scope (confirmed with owner)

Replace Supabase entirely with a **Python/Django + DRF** backend that exposes a clean REST API
consumed by **both** a new **website** (Next.js) **and** the existing **Expo mobile app** (rewired
off Supabase). Pre‑launch → **no production data/user migration** (schema built fresh; password
migration not needed). **Fully off Supabase** (Auth, Postgres, Storage, Edge Functions, Realtime all
replaced). **Local‑first with Docker** now; production hosting decided later.

Non‑negotiables from the owner: correct, clean code (no "dumb code"), **don't break existing tests**,
**test everything as we go**.

## 2. Target architecture

```
                         ┌────────────────────────┐
   Expo mobile app  ───▶ │                        │
                         │   Django + DRF  (API)  │ ──▶ Postgres (Django ORM)
   Next.js website  ───▶ │   JWT auth, per-user   │ ──▶ Redis  (Celery broker/result)
                         │   permissions          │ ──▶ MinIO  (S3 object storage)
   Public share page ──▶ │                        │ ──▶ Mailpit (dev email)
                         └───────────┬────────────┘
                                     │ enqueue
                                     ▼
                         Celery worker(s)  ──▶ OpenAI (extract / OCR / transcribe / evaluate)
                         Celery beat       ──▶ periodic: stale-job recovery, share cleanup
```

**Repo layout (one repo):**
- `backend/` — Django project (this migration). Self‑contained Docker Compose stack.
- `web/` — Next.js website (later phase).
- *(existing)* mobile app stays at repo root; rewired to the API in a later phase.
- *(removed at the end)* `supabase/`, `worker/` (ported), the `*-web` static pages (folded into `web/`).

**Django apps** (under `backend/`): `accounts` (custom User + auth), `profiles` (user_profiles),
`documents`, `timeline`, `health` (health_profiles, health_evaluations), `jobs` (ai_jobs, ai_job_events
+ Celery tasks = the worker), `shares` (share_packages/items + public resolve), `qa` (answer‑health‑question),
`common` (base models, storage, permissions, OpenAI client).

## 3. Data model (Django, mirrors the live schema)

Custom user replaces `auth.users`. All former `user_id uuid FK auth.users` become FK to `accounts.User`
(UUID pk). UUID pks via `uuid.uuid4`. `jsonb` → `JSONField`; the 7 medical array fields + `tags`/`data`/
`progress` default to list/dict appropriately. `text[] tags` → `ArrayField(TextField)`. `created_at`/
`updated_at` → `auto_now_add`/`auto_now` (preserve `updated_at` monotonicity — the staleness banner relies
on it). No DB CHECK/enums today (free‑text); we add `choices` for validation on **new writes only** but do
**not** add DB constraints that could reject legacy‑style values.

| Model | Key fields / notes |
|---|---|
| `accounts.User` | UUID pk, email (unique, USERNAME_FIELD), password, is_active, date_joined. No username. Custom manager. |
| `profiles.UserProfile` | OneToOne(User, unique); names, dob, demographics, contact, emergency contact, lifestyle, `current_symptoms`; **7 JSON array fields** (allergies, medications, medical_history, surgical_history, family_history, hospitalizations, social_history) default `[]`; `story_answers`, `ai_backfill_meta` JSON; `onboarding_completed_at`, `health_linked_at`, `avatar_path`. |
| `documents.Document` | FK(User); title; `status` (uploaded/processing/processed/failed); `source_type` (file/pdf/scanned_pdf/voice_note/manual_input/image); `pdf_path`/`fhir_path`/`summary_path`; mime, size_bytes, sha256, processing_error, processed_at; `content_json` JSON. **Partial unique**: one `manual_input` doc per user. |
| `timeline.TimelineEvent` | FK(User); FK(Document, null, `on_delete=SET_NULL`); occurred_at (date, null), date_precision; title, event_type, category, source, summary; `tags` ArrayField; `data` JSON; `included_in_previsit` bool. |
| `health.HealthProfile` | **OneToOne(User, primary_key=True)**; score, score_label; `summary_json`, `card_json`, `sources` JSON; `version` (default **`profile_v2`** — fixes the v1/v2 drift). |
| `health.HealthEvaluation` | FK(User); score; `result` JSON; append‑only. |
| `jobs.AiJob` | FK(User); job_type (process_documents/profile_evaluation); `document_ids` ArrayField(UUID); status (queued/running/processing/succeeded/failed/cancelled); priority, attempts, locked_at, locked_by, stage, heartbeat_at, `progress` JSON, error, `result` JSON, `cancel_requested`, cancelled_at. |
| `jobs.AiJobEvent` | BigAuto pk; FK(AiJob); at, level (debug/info/warn/error), message, `data` JSON. |
| `shares.SharePackage` | FK(User, `owner`); **`token_hash` unique‑indexed**; file_type (health_profile/summary/fhir/pdf); expires_at, revoked, max_views, views_count, `pin_hash`, pin_attempts, `payload_json`, artifacts_deleted_at. |
| `shares.SharePackageItem` | FK(SharePackage), FK(Document); `unique_together(package, document)` (the old composite pk) + surrogate id. |

Legacy `document_facts` (empty) and `analysis_jobs` (empty, unreferenced) are **not** recreated; the
worker writes facts to object storage (`{user}/processed/{doc}/summary.json`) as today.

JSON shapes (validated by serializers, documented in code): allergy `{id,allergen,reaction,severity}`,
medication `{id,name,dose,frequency}`, history items `{id,condition|procedure,year,notes}`, social
`{id,category,detail}`, `story_answers` q1..q10, `ai_backfill_meta.fields[f]{source,job_id,evaluation_id,
last_backfill_at,added_keys,current_item_ids}` (AI items prefixed `ai_`), `summary_json{overview,
highlights,risk_flags,missing_info,suggested_next_steps,recommendations,full_summary_markdown,disclaimer}`,
`card_json` = 3×5 card, `sources{job_type,document_ids,apple_health,manual_profile,evaluation_storage_path,
evaluation_id}`.

## 4. Auth (replaces Supabase Auth)

DRF + `djangorestframework-simplejwt`. Access + refresh tokens; client stores them in AsyncStorage
(mobile) / httpOnly‑cookie or localStorage (web) — same persistence pattern as today.
- `POST /api/auth/register` (email+password; email‑verify flow), `/login`, `/token/refresh`, `/logout`.
- `POST /api/auth/password/forgot` + `/password/reset` (Django token generator; email via Mailpit locally).
- `POST /api/auth/password/change` (authenticated; mobile then signs out — preserve current UX).
- Email verification: token link → `/api/auth/verify-email`. Local: emails caught by Mailpit.
- **Per‑user isolation replaces RLS**: a global `IsOwner` permission + querysets filtered by
  `request.user`. This is a launch blocker today (RLS is the only cross‑user guard) — every endpoint
  enforces ownership; covered by explicit permission tests.

## 5. REST API (maps every client call from the map)

DRF `ModelViewSet`s + targeted actions. Offset pagination (matches the client's `.range()`), filtering
via `django-filter`, ordering params. Resources: `profiles`, `documents`, `timeline-events`,
`health-profile`, `health-evaluations`, `ai-jobs`. Special endpoints (from edge functions):
- `POST /api/jobs/enqueue` — split manual_input→profile_evaluation vs file→process_documents; dedupe
  against queued/running; mark docs processing; enqueue Celery; return `{jobId, reused, manualDocIds}`.
- `POST /api/profiles/me/enqueue-evaluation` — profile‑only eval.
- `POST /api/documents/upload` (multipart) + `POST /api/profiles/me/avatar` — file ingest → object storage.
- `GET /api/documents/{id}/file` / avatar URL → short‑TTL signed URL (or streamed).
- `DELETE /api/account` — cascading delete (ordered) + storage cleanup (the delete‑account function).
- `POST /api/shares` (create), `POST /api/shares/resolve` (**public**, token+pin), `GET /api/shares` (redirect).
- `POST /api/qa` — answer‑health‑question (OpenAI, context‑bounded, JSON `{answer, sources}`).
A generated **OpenAPI schema** (`drf-spectacular`) becomes the source of truth for the web + mobile clients.

## 6. Storage (replaces Supabase Storage)

`django-storages` + `boto3` → MinIO locally (S3 in prod). Buckets→prefixes preserved:
`documents/{user}/medical-documents|medical-images|voice-notes/…`, `{user}/processed/{doc}/summary.json`,
`{user}/ai/evaluation/latest.json`; `profile-pictures/{user}/avatar.jpg`; `share-artifacts/{uuid}/{type}.pdf`.
Enforce **10MB + PDF‑only** on share artifacts; short‑TTL signed URLs (avatar 600s, share PDF 120s, doc 60s);
recursive prefix delete with pagination. Avatar processing (512², EXIF‑stripped) server‑side (Pillow).

## 7. AI worker (port `worker/` → Celery)

`jobs` app holds Celery tasks. Broker/result = Redis. Tasks: `process_documents_task(job_id)`,
`profile_evaluation_task(job_id)`, plus internal helpers (extract facts, evaluate, backfill). Replaces the
`while(true)` + `claim_ai_job` RPC with proper enqueue; **keeps**: status lifecycle, `progress`/`stage`/
`heartbeat` writes (so the client progress UI still works), cooperative cancel (`cancel_requested` polled →
revoke), **stale‑job recovery** (Celery beat, 30‑min) and the **backfill + suppression** logic (port exactly —
it's subtle: AI items `ai_`‑prefixed, deleted items must not resurface). Python libs: `pypdf`/`pdfplumber`
(text), `PyMuPDF` (render pages for OCR), `Pillow`, OpenAI Python SDK. Models/config reuse `worker/.env`
values via Django settings (OPENAI_*, AI_MODEL_*). The huge evaluation system‑prompt + the Zod schemas are
ported verbatim to Python (pydantic/DRF serializers) — semantics must not drift.

## 8. Share‑link system (security‑critical — port faithfully + harden)

256‑bit `secrets.token_urlsafe`, store only `sha256(token)`; **hardcoded** expiry (1 min) + max views (2),
**not** client‑overridable; optional PIN hashed, compared with `secrets.compare_digest`; resolve order:
lookup→revoked→expiry(+auto‑cleanup)→PIN→view‑limit→increment→signed URLs. Add: **per‑token PIN rate‑limit/
lockout**, throttling on the public resolve endpoint, server‑authoritative expiry. PDF generation (the 4
builders) ported to Python (`reportlab`/`pypdf`). Beat task cleans expired artifacts.

## 9. Realtime → polling

Drop Supabase realtime. The client already has polling fallbacks (ai‑jobs progress) and `useFocusEffect`
reloads. v1 = **polling** endpoints (`GET /api/ai-jobs?status__in=queued,running`, health‑profile fetch on
focus). WebSockets (Django Channels) deferred unless instant push is required.

## 10. Web frontend (`web/`, later phase)

Next.js (App Router) + TS + Tailwind on the API. v1 scope mirrors core flows: auth (register/login/verify/
reset), profile + medical profile, document upload + processing status, health summary + SHIN score +
recommendations, timeline, pre‑visit note, share, **public share view** (folds in `share-web`), QA. The
existing `reset-web`/`share-web`/`verify-web` static pages become routes here.

## 11. Mobile rewire (later phase)

Replace `src/lib/supabase.ts` with an `apiClient` (fetch + JWT + refresh). Rewrite the data‑layer libs
(`profile.ts`, `documents.ts`, `aiJobs.ts`, `avatar.ts`, `storageUpload.ts`, `auth.ts`, `health/syncAppleHealth.ts`)
and the realtime subscriptions → polling. Keep screens unchanged where possible. **Keep the vitest suite
green**: pure‑logic tests (timeline, healthkit, mapping, share, processing UI) unchanged; `aiQuestionSearch`
re‑pointed to the new endpoint; native/UI/static tests untouched.

## 12. Testing strategy

`pytest` + `pytest-django` + `factory_boy` + DRF `APIClient`, coverage gate. Cover: every endpoint
(happy + auth/ownership + validation), the full job pipeline (OpenAI mocked), backfill/suppression,
share‑link security (expiry, view‑limit, PIN lockout, ownership), storage signed‑URL + cascade delete,
auth flows. Port the 3 pure‑logic vitest suites to pytest as parity tests. Keep the mobile vitest suite
runnable throughout; CI runs both suites.

## 13. Local dev (Docker Compose, `backend/docker-compose.yml`)

Services: `db` (postgres:16), `redis`, `minio` (+ `createbuckets` init), `mailpit`, `web` (Django/gunicorn
+ a dev `runserver`), `worker` (celery), `beat` (celery beat). `.env` from `.env.example`. One command:
`docker compose up`. Fast inner loop also supported via a local venv (`manage.py`, `pytest`) against the
compose `db`/`redis`/`minio`.

## 14. Phased plan (execution roadmap)

0. **Scaffold** — `backend/` Django+DRF project, settings split, Docker Compose (db/redis/minio/mailpit),
   `accounts.User`, pytest, health endpoint. *Verify: `manage.py check`, a pytest smoke test, compose boots.*
1. **Models + migrations** — all 9 models, constraints, admin. *Tests: model + constraint tests.*
2. **Auth** — JWT register/login/refresh/logout, email‑verify, password reset/change. *Tests: flows.*
3. **Core API** — profiles, documents, timeline, health, ai‑jobs viewsets + IsOwner + pagination/filter.
   *Tests: CRUD + ownership + validation.*
4. **Storage** — MinIO uploads (documents, avatar), signed URLs, cascade delete + account delete. *Tests.*
5. **Jobs/worker** — Celery tasks porting the AI pipeline (extract/OCR/transcribe/evaluate/backfill/
   suppression), enqueue endpoint, progress/heartbeat/cancel, beat stale‑recovery. *Tests: OpenAI mocked.*
6. **Shares + QA** — share create/resolve (security‑hardened), PDF builders, cleanup beat; QA endpoint. *Tests.*
7. **Parity + integration** — port pure‑logic vitest → pytest; end‑to‑end happy path on the compose stack;
   OpenAPI schema published.
8. **Web frontend** — Next.js app on the API (core flows + public share view).
9. **Mobile rewire** — swap Supabase → apiClient; keep vitest green.
10. **Cleanup** — remove `supabase/`, old `worker/`, static `*-web`; seed/dev fixtures; docs; final verify.

Each phase: build → test → `manage.py check`/`pytest` green → commit. Workflows parallelize independent
breadth (test files, web pages, mobile libs); foundational/coupled code is authored directly.

## 15. Key decisions & risks

- **Pre‑launch** removes the hardest risk (no live data/password migration, no cutover).
- **Fix the `profile_v1`/`profile_v2` drift** → default `profile_v2`.
- **Ownership checks are mandatory** everywhere (RLS is gone) — enforced + tested; treat as security gate.
- **AI evaluation/extraction prompts + schemas must be ported verbatim** — behavior parity is essential.
- **Share‑link security** is the most sensitive surface — port faithfully and add PIN lockout + throttling.
- Realtime→polling is a deliberate v1 simplification (client already supports polling).
- Scope is large and multi‑phase; delivered as tested increments on `feat/django-backend-migration`,
  pausing only at genuine blockers (e.g., a hosting/credential decision) per the owner's "don't stop" ask.
```
