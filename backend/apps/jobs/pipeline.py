"""AI job pipeline orchestration — port of worker/src/main.ts.

Two pipelines (process_documents, profile_evaluation) share a common evaluation
tail. Faithful to the orchestration spec: per-doc extraction, suppression
filtering, manual-override card merge, non-fatal backfill, batch mark-processed.
Cancellation is cooperative (polls AiJob.cancel_requested).
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone as djtz

from apps.documents.models import Document
from apps.health.models import HealthEvaluation, HealthProfile
from apps.profiles.models import UserProfile
from apps.timeline.models import TimelineEvent

from . import ai_client, extraction, index, profile_logic
from .models import AiJob, AiJobEvent

TEXT_CAP = 180_000


class CancellationError(Exception):
    pass


# ── job bookkeeping ───────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _set_stage(job: AiJob, stage: str, progress: dict | None = None) -> None:
    job.stage = stage
    job.heartbeat_at = djtz.now()
    if progress is not None:
        job.progress = progress
    job.save(update_fields=["stage", "heartbeat_at", "progress", "updated_at"])


def _log(job: AiJob, level: str, message: str, data: dict | None = None) -> None:
    AiJobEvent.objects.create(job=job, level=level, message=message, data=data)


def _check_cancelled(job: AiJob) -> None:
    row = AiJob.objects.filter(pk=job.pk).values("cancel_requested", "status").first()
    if row and (row["cancel_requested"] or row["status"] == AiJob.Status.CANCELLED):
        raise CancellationError()


def _summary_key(user_id, doc_id) -> str:
    return f"documents/{user_id}/processed/{doc_id}/summary.json"


def _evaluation_key(user_id) -> str:
    return f"documents/{user_id}/ai/evaluation/latest.json"


def _write_json(key: str, obj: dict) -> None:
    if default_storage.exists(key):
        default_storage.delete(key)
    default_storage.save(key, ContentFile(json.dumps(obj).encode("utf-8")))


def _read_json(key: str) -> dict | None:
    try:
        with default_storage.open(key) as fh:
            return json.loads(fh.read())
    except Exception:
        return None


# ── per-document extraction ───────────────────────────────────────────────────

def _normalize_event_date(occurred_at):
    if not occurred_at:
        return None, ""
    parts = str(occurred_at).split("-")
    try:
        if len(parts) >= 3:
            return date(int(parts[0]), int(parts[1]), int(parts[2])), "day"
        if len(parts) == 2:
            return date(int(parts[0]), int(parts[1]), 1), "month"
        if len(parts) == 1 and parts[0]:
            return date(int(parts[0]), 1, 1), "year"
    except (ValueError, TypeError):
        return None, ""
    return None, ""


def _process_one_document(job: AiJob, doc: Document, idx: int, total: int) -> dict:
    user_id = job.user_id
    _check_cancelled(job)
    _set_stage(job, "downloading_file", {"total": total, "done": idx, "currentDocId": str(doc.id)})

    if not doc.pdf_path:
        facts = {
            "document_id": str(doc.id), "title": doc.title,
            "key_facts": {"blood_type": None, "allergies": [], "medications": [], "conditions": [],
                          "surgeries_procedures": [], "implants_devices": [], "key_labs_vitals": [], "extra_notes": []},
            "timeline_events": [], "confidence_0_to_1": 0.1,
        }
        _write_json(_summary_key(user_id, doc.id), facts)
        Document.objects.filter(id=doc.id).update(
            summary_path=_summary_key(user_id, doc.id), processed_at=djtz.now(), processing_error=""
        )
        _set_stage(job, "document_done", {"total": total, "done": idx + 1, "currentDocId": str(doc.id)})
        return facts

    with default_storage.open(doc.pdf_path) as fh:
        buf = fh.read()

    is_audio = (doc.mime_type or "").startswith("audio/")
    _check_cancelled(job)
    if is_audio:
        _set_stage(job, "transcribing_audio", {"total": total, "done": idx, "currentDocId": str(doc.id)})
        raw_text = ai_client.transcribe_audio(buf, doc.mime_type) or "[No transcript text found in this audio.]"
    else:
        _set_stage(job, "extracting_text", {"total": total, "done": idx, "currentDocId": str(doc.id)})
        content = extraction.extract_pdf(buf)
        parts: list[str] = []
        for n, page in enumerate(content.pages, start=1):
            if page.text:
                parts.append(page.text)
            if page.images:
                _check_cancelled(job)
                _set_stage(job, "ocr_pdf", {"total": total, "done": idx, "currentDocId": str(doc.id)})
                ocr = ""
                try:
                    ocr = ai_client.ocr_images(page.images)
                except Exception as exc:  # non-fatal: keep the text layer
                    _log(job, "warn", f"OCR failed on page {n}: {exc}")
                if ocr:
                    parts.append(f"[IMAGE OCR — page {n}]\n{ocr}")
        raw_text = "\n\n".join(parts)
        if not raw_text.strip():
            raw_text = "[No extractable text found in this document.]"

    capped = raw_text[:TEXT_CAP]
    text = f"VOICE NOTE TRANSCRIPT:\n{capped}" if is_audio else capped

    _check_cancelled(job)
    _set_stage(job, "openai_extract", {"total": total, "done": idx, "currentDocId": str(doc.id)})
    facts_model = ai_client.extract_document_facts(str(doc.id), doc.title, text)
    facts = facts_model.model_dump()

    _write_json(_summary_key(user_id, doc.id), facts)

    _check_cancelled(job)
    TimelineEvent.objects.filter(user_id=user_id, document_id=doc.id, source="document_ai").delete()
    new_events = []
    for ev in facts.get("timeline_events", []):
        occurred, precision = _normalize_event_date(ev.get("occurred_at"))
        data = {kv["key"]: kv["value"] for kv in ev.get("data_kv", []) if isinstance(kv, dict) and "key" in kv}
        new_events.append(TimelineEvent(
            user_id=user_id, document_id=doc.id, occurred_at=occurred, date_precision=precision,
            title=ev.get("title", ""), event_type=ev.get("event_type") or "",
            category=ev.get("category") or "", source="document_ai", summary=ev.get("summary") or "",
            tags=ev.get("tags", []) or [], data=data, included_in_previsit=False,
        ))
    if new_events:
        TimelineEvent.objects.bulk_create(new_events)

    _check_cancelled(job)
    Document.objects.filter(id=doc.id).update(
        summary_path=_summary_key(user_id, doc.id), processed_at=djtz.now(), processing_error=""
    )
    try:
        index.reindex_document(doc, text=text)
    except Exception as exc:  # non-fatal: the search index is best-effort
        _log(job, "warn", f"Embedding reindex failed for {doc.id}: {exc}")
    _set_stage(job, "document_done", {"total": total, "done": idx + 1, "currentDocId": str(doc.id)})
    return facts


# ── card merge + evaluatable-data gate ────────────────────────────────────────

def merge_card_with_profile(card: dict, manual_ctx: dict, raw_profile: dict | None) -> dict:
    merged = dict(card)
    if raw_profile is None:
        return merged

    def has_manual_items(field):
        return any(not profile_logic.is_ai_backfilled(i.get("id")) for i in (raw_profile.get(field) or []) if isinstance(i, dict))

    raw_allergies = raw_profile.get("allergies")
    if manual_ctx.get("allergies"):
        merged["allergies"] = [a["allergen"] for a in manual_ctx["allergies"]]
    elif isinstance(raw_allergies, list) and not has_manual_items("allergies"):
        # user has no manual allergies (empty or only AI items the model already saw)
        if len(raw_allergies) == 0:
            merged["allergies"] = []

    raw_meds = raw_profile.get("medications")
    if manual_ctx.get("medications"):
        merged["current_meds"] = [
            " ".join(p for p in [m.get("name"), m.get("dose"), m.get("frequency")] if p)
            for m in manual_ctx["medications"]
        ]
    elif isinstance(raw_meds, list) and not has_manual_items("medications"):
        if len(raw_meds) == 0:
            merged["current_meds"] = []

    name = (raw_profile.get("emergency_contact_name") or "").strip()
    phone = (raw_profile.get("emergency_contact_phone") or "").strip()
    if name or phone:
        merged["emergency_contact"] = {"name": name or None, "phone": phone or None}
    return merged


def has_any_evaluatable_data(doc_facts, apple_health, manual_ctx, backfill_ctx) -> bool:
    if doc_facts:
        return True
    if any(v is not None for v in (apple_health or {}).values()):
        return True
    if manual_ctx and manual_ctx.get("_has_clinical_data"):
        return True
    if manual_ctx and (manual_ctx.get("lifestyle") or manual_ctx.get("story_context")):
        return True
    demo = (manual_ctx or {}).get("demographics", {})
    if demo.get("age_years") is not None or demo.get("sex_or_gender"):
        return True
    if backfill_ctx:
        return True
    return False


# ── common evaluation tail ────────────────────────────────────────────────────

def _profile_row(user_id) -> tuple[UserProfile | None, dict]:
    profile = UserProfile.objects.filter(user_id=user_id).first()
    if profile is None:
        return None, {}
    fields = [
        "first_name", "last_name", "date_of_birth", "sex_or_gender", "occupation", "marital_status",
        "number_of_children", "smoking_status", "alcohol_use", "exercise_level", "current_symptoms",
        "allergies", "medications", "medical_history", "surgical_history", "family_history",
        "hospitalizations", "social_history", "story_answers", "ai_backfill_meta",
        "emergency_contact_name", "emergency_contact_phone",
    ]
    raw = {}
    for f in fields:
        v = getattr(profile, f)
        if f == "date_of_birth" and v is not None:
            v = v.isoformat()
        raw[f] = v
    return profile, raw


def _common_tail(job: AiJob, doc_facts: list[dict], limited_doc_ids: list, manual_doc_ids: list) -> None:
    user_id = job.user_id

    snapshot_events = list(
        TimelineEvent.objects.filter(user_id=user_id, source="apple_health")
        .order_by("-occurred_at")[:200]
        .values("event_type", "occurred_at", "data")
    )
    apple_health = extraction.apple_health_snapshot(snapshot_events)

    historical = []
    hist_qs = Document.objects.filter(
        user_id=user_id, status=Document.Status.PROCESSED, summary_path__gt=""
    ).exclude(source_type=Document.SourceType.MANUAL_INPUT).exclude(id__in=limited_doc_ids)
    for d in hist_qs:
        data = _read_json(d.summary_path)
        if data:
            historical.append(data)
    all_doc_facts_raw = historical + doc_facts

    _set_stage(job, "loading_manual_profile")
    profile, raw_profile = _profile_row(user_id)
    manual_ctx = profile_logic.build_manual_profile_context(raw_profile) if raw_profile else {}
    backfill_ctx = profile_logic.build_ai_backfilled_context(raw_profile) if raw_profile else None

    suppressed = profile_logic.compute_suppressed_keys(raw_profile or {})
    all_doc_facts = profile_logic.filter_doc_facts_by_suppression(all_doc_facts_raw, suppressed)

    if not has_any_evaluatable_data(all_doc_facts, apple_health, manual_ctx, backfill_ctx):
        _fail(job, "No evaluatable data found. Complete at least your basic profile or upload a document.")
        return

    _check_cancelled(job)
    _set_stage(job, "openai_eval", {
        "totalDocFacts": len(all_doc_facts),
        "isProfileOnly": len(doc_facts) == 0,
        "hasClinicalData": bool(manual_ctx.get("_has_clinical_data")),
    })
    evaluation = ai_client.evaluate_user_health(
        str(user_id), all_doc_facts, apple_health, manual_profile=manual_ctx or None, profile_backfill=backfill_ctx
    ).model_dump()

    merged_card = merge_card_with_profile(evaluation["three_by_five_card"], manual_ctx, raw_profile or None)

    eval_result = {**evaluation, "three_by_five_card": merged_card}
    eval_row = HealthEvaluation.objects.create(
        user_id=user_id, score=evaluation["score_0_to_100"], result=eval_result
    )
    _write_json(_evaluation_key(user_id), eval_result)

    _check_cancelled(job)
    _set_stage(job, "saving_profile")
    processed_ids = [str(i) for i in Document.objects.filter(
        user_id=user_id, status=Document.Status.PROCESSED
    ).values_list("id", flat=True)]
    all_ids = sorted(set(processed_ids + [str(i) for i in limited_doc_ids] + [str(i) for i in manual_doc_ids]))
    manual_sig = json.dumps({
        "allergies": (raw_profile or {}).get("allergies"),
        "medications": (raw_profile or {}).get("medications"),
        "medical_history": (raw_profile or {}).get("medical_history"),
    }, sort_keys=True, default=str)

    summary_json = {k: evaluation[k] for k in (
        "overview", "highlights", "risk_flags", "missing_info",
        "suggested_next_steps", "recommendations", "full_summary_markdown", "disclaimer",
    )}
    sources = {
        "job_type": job.job_type,
        "document_ids": all_ids,
        "apple_health": apple_health,
        "manual_profile": {
            "has_data": bool(raw_profile),
            "has_clinical_data": bool(manual_ctx.get("_has_clinical_data")),
            "signature": manual_sig,
        },
        "evaluation_storage_path": _evaluation_key(user_id),
        "evaluation_id": str(eval_row.id),
    }
    HealthProfile.objects.update_or_create(
        user_id=user_id,
        defaults={
            "score": evaluation["score_0_to_100"], "score_label": evaluation["score_label"],
            "summary_json": summary_json, "card_json": merged_card, "sources": sources, "version": "profile_v2",
        },
    )

    # Non-fatal AI backfill.
    if all_doc_facts and profile is not None:
        _set_stage(job, "ai_backfill")
        try:
            candidates = profile_logic.extract_backfill_candidates(all_doc_facts)
            result = profile_logic.compute_backfill_patch(
                raw_profile, candidates, {"job_id": str(job.id), "evaluation_id": str(eval_row.id)}
            )
            if result:
                for field, value in result["patch"].items():
                    setattr(profile, field, value)
                profile.save()
                HealthProfile.objects.filter(user_id=user_id).update(updated_at=djtz.now())
                _log(job, "info", "AI backfill applied", result["summary"])
            else:
                _log(job, "info", "AI backfill: no new items to add")
        except Exception as exc:  # non-fatal
            _log(job, "warn", f"AI backfill failed: {exc}")

    all_job_doc_ids = list(limited_doc_ids) + list(manual_doc_ids)
    if all_job_doc_ids:
        Document.objects.filter(
            user_id=user_id, id__in=all_job_doc_ids, status=Document.Status.PROCESSING
        ).update(status=Document.Status.PROCESSED)

    job.status = AiJob.Status.SUCCEEDED
    job.error = ""
    job.result = {"health_profile_updated": True, "evaluation_id": str(eval_row.id)}
    job.locked_at = None
    job.locked_by = ""
    job.save(update_fields=["status", "error", "result", "locked_at", "locked_by", "updated_at"])


# ── entry points ──────────────────────────────────────────────────────────────

def _fail(job: AiJob, message: str) -> None:
    job.status = AiJob.Status.FAILED
    job.error = message
    job.locked_at = None
    job.locked_by = ""
    job.save(update_fields=["status", "error", "locked_at", "locked_by", "updated_at"])
    _log(job, "error", message)


def _cancel(job: AiJob) -> None:
    job.status = AiJob.Status.CANCELLED
    job.cancelled_at = djtz.now()
    job.error = ""
    job.locked_at = None
    job.locked_by = ""
    job.save(update_fields=["status", "cancelled_at", "error", "locked_at", "locked_by", "updated_at"])
    Document.objects.filter(
        user_id=job.user_id, id__in=job.document_ids, status=Document.Status.PROCESSING
    ).update(status=Document.Status.UPLOADED, processing_error="")


def run_job(job_id) -> None:
    job = AiJob.objects.filter(pk=job_id).first()
    if job is None or job.status in (AiJob.Status.SUCCEEDED, AiJob.Status.CANCELLED):
        return
    job.status = AiJob.Status.RUNNING
    job.save(update_fields=["status", "updated_at"])
    _set_stage(job, "started")
    try:
        if job.job_type == AiJob.JobType.PROCESS_DOCUMENTS:
            _set_stage(job, "fetching_documents")
            docs = list(Document.objects.filter(
                user_id=job.user_id, id__in=job.document_ids
            ).exclude(source_type=Document.SourceType.MANUAL_INPUT))
            doc_facts = []
            for idx, doc in enumerate(docs):
                doc_facts.append(_process_one_document(job, doc, idx, len(docs)))
            _common_tail(job, doc_facts, [d.id for d in docs], [])
        else:  # profile_evaluation
            _common_tail(job, [], [], list(job.document_ids))
    except CancellationError:
        _cancel(job)
    except Exception as exc:
        _fail(job, str(exc))
        raise


# ── stale recovery (celery beat) ──────────────────────────────────────────────

def recover_stale_jobs() -> int:
    from datetime import timedelta

    cutoff = djtz.now() - timedelta(minutes=30)
    stale = list(AiJob.objects.filter(status=AiJob.Status.RUNNING, updated_at__lt=cutoff))
    for job in stale:
        job.status = AiJob.Status.FAILED
        job.error = "Job timed out - worker may have crashed. You can retry."
        job.locked_at = None
        job.locked_by = ""
        job.save(update_fields=["status", "error", "locked_at", "locked_by", "updated_at"])
        Document.objects.filter(
            user_id=job.user_id, id__in=job.document_ids, status=Document.Status.PROCESSING
        ).update(status=Document.Status.UPLOADED, processing_error="")
    return len(stale)
