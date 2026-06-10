"""AI pipeline tests with OpenAI mocked (eager, synchronous)."""
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone

from apps.documents.models import Document
from apps.health.models import HealthEvaluation, HealthProfile
from apps.jobs import ai_client, extraction, pipeline
from apps.jobs.models import AiJob
from apps.jobs.schemas import DocumentFacts, HealthEvaluation as HEval
from apps.profiles.models import UserProfile

User = get_user_model()


def fake_evaluation(**over):
    base = {
        "score_0_to_100": 78, "score_label": "Strong", "overview": "ok",
        "highlights": [], "risk_flags": [], "missing_info": [], "suggested_next_steps": [],
        "recommendations": [], "three_by_five_card": {
            "blood_type": "O+", "major_conditions": [], "major_surgeries": [], "current_meds": [],
            "allergies": [], "implants_devices": [], "anticoagulants": [], "anesthesia_notes": [],
            "emergency_contact": {"name": None, "phone": None}, "one_line_summary": "Healthy",
        },
        "full_summary_markdown": "Summary.", "disclaimer": "Informational only.",
    }
    base.update(over)
    return HEval.model_validate(base)


def fake_facts(doc_id, **over):
    base = {
        "document_id": str(doc_id), "title": "Doc",
        "key_facts": {"blood_type": None, "allergies": [], "medications": [{"name": "Metformin"}],
                      "conditions": [{"name": "Diabetes"}], "surgeries_procedures": [],
                      "implants_devices": [], "key_labs_vitals": [], "extra_notes": []},
        "timeline_events": [{"occurred_at": "2024-05-01", "date_precision": "day", "title": "Visit",
                             "tags": [], "data_kv": [{"key": "bp", "value": "120/80"}]}],
        "confidence_0_to_1": 0.9,
    }
    base.update(over)
    return DocumentFacts.model_validate(base)


@pytest.fixture
def user(db):
    return User.objects.create_user(email="a@example.com", password="pw")


@pytest.fixture
def mock_ai(monkeypatch):
    monkeypatch.setattr(ai_client, "evaluate_user_health", lambda *a, **k: fake_evaluation())
    monkeypatch.setattr(
        extraction, "extract_pdf",
        lambda data, **k: extraction.PdfContent(
            pages=[extraction.PageContent(text="diabetic patient notes " * 20, images=[])]
        ),
    )
    monkeypatch.setattr(ai_client, "ocr_images", lambda *a, **k: "")  # no images in fixture; guard against hitting the real API


def test_profile_evaluation_creates_health_profile(user, mock_ai):
    UserProfile.objects.create(user=user, medical_history=[{"id": "u1", "condition": "Hypertension"}])
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROFILE_EVALUATION, document_ids=[])
    pipeline.run_job(job.id)
    job.refresh_from_db()
    assert job.status == AiJob.Status.SUCCEEDED
    hp = HealthProfile.objects.get(user=user)
    assert hp.score == 78 and hp.version == "profile_v2"
    assert HealthEvaluation.objects.filter(user=user).count() == 1
    assert hp.sources["job_type"] == "profile_evaluation"


def test_profile_evaluation_no_data_fails_gracefully(user, mock_ai):
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROFILE_EVALUATION, document_ids=[])
    pipeline.run_job(job.id)
    job.refresh_from_db()
    assert job.status == AiJob.Status.FAILED
    assert "evaluatable" in job.error.lower()
    assert not HealthProfile.objects.filter(user=user).exists()


def test_process_documents_full_flow(user, mock_ai, monkeypatch):
    doc = Document.objects.create(user=user, source_type="pdf", status="processing", mime_type="application/pdf")
    doc.pdf_path = default_storage.save(f"documents/{user.id}/x.pdf", ContentFile(b"%PDF-1.4 fake"))
    doc.save()
    monkeypatch.setattr(ai_client, "extract_document_facts", lambda *a, **k: fake_facts(doc.id))
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id])
    pipeline.run_job(job.id)
    job.refresh_from_db(); doc.refresh_from_db()
    assert job.status == AiJob.Status.SUCCEEDED
    assert doc.status == "processed" and doc.summary_path
    assert default_storage.exists(doc.summary_path)
    assert HealthProfile.objects.filter(user=user).exists()
    # timeline event was written from the extracted facts
    assert user.timeline_events.filter(source="document_ai").count() == 1


def test_cancellation_reverts_documents(user, mock_ai):
    doc = Document.objects.create(user=user, source_type="pdf", status="processing")
    job = AiJob.objects.create(
        user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id], cancel_requested=True
    )
    pipeline.run_job(job.id)
    job.refresh_from_db(); doc.refresh_from_db()
    assert job.status == AiJob.Status.CANCELLED
    assert doc.status == "uploaded"


def test_merge_card_manual_allergies_win(user):
    card = {"allergies": ["Latex"], "current_meds": [], "emergency_contact": {"name": None, "phone": None}}
    manual = {"allergies": [{"allergen": "Penicillin"}]}
    raw = {"allergies": [{"id": "u1", "allergen": "Penicillin"}], "emergency_contact_name": "Jane", "emergency_contact_phone": "555"}
    merged = pipeline.merge_card_with_profile(card, manual, raw)
    assert merged["allergies"] == ["Penicillin"]
    assert merged["emergency_contact"] == {"name": "Jane", "phone": "555"}


def test_stale_recovery(user):
    doc = Document.objects.create(user=user, source_type="pdf", status="processing")
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS,
                               status="running", document_ids=[doc.id])
    AiJob.objects.filter(pk=job.pk).update(updated_at=timezone.now() - timedelta(minutes=45))
    assert pipeline.recover_stale_jobs() == 1
    job.refresh_from_db(); doc.refresh_from_db()
    assert job.status == AiJob.Status.FAILED and doc.status == "uploaded"


def test_pdf_image_ocr_is_interleaved(user, mock_ai, monkeypatch):
    doc = Document.objects.create(user=user, source_type="pdf", status="processing",
                                  mime_type="application/pdf")
    doc.pdf_path = default_storage.save(f"documents/{user.id}/x.pdf", ContentFile(b"%PDF-1.4 fake"))
    doc.save()
    monkeypatch.setattr(
        extraction, "extract_pdf",
        lambda data, **k: extraction.PdfContent(
            pages=[extraction.PageContent(text="page one text", images=[b"img"])]
        ),
    )
    monkeypatch.setattr(ai_client, "ocr_images", lambda *a, **k: "OCR FINDINGS")
    captured = {}

    def fake_extract(doc_id, title, text):
        captured["text"] = text
        return fake_facts(doc.id)

    monkeypatch.setattr(ai_client, "extract_document_facts", fake_extract)
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id])
    pipeline.run_job(job.id)
    job.refresh_from_db()
    assert job.status == AiJob.Status.SUCCEEDED
    assert "page one text" in captured["text"]
    assert "[IMAGE OCR — page 1]" in captured["text"]
    assert "OCR FINDINGS" in captured["text"]


def test_pdf_ocr_failure_is_non_fatal(user, mock_ai, monkeypatch):
    doc = Document.objects.create(user=user, source_type="pdf", status="processing",
                                  mime_type="application/pdf")
    doc.pdf_path = default_storage.save(f"documents/{user.id}/y.pdf", ContentFile(b"%PDF-1.4 fake"))
    doc.save()
    monkeypatch.setattr(
        extraction, "extract_pdf",
        lambda data, **k: extraction.PdfContent(
            pages=[extraction.PageContent(text="surviving text", images=[b"img"])]
        ),
    )

    def boom(*a, **k):
        raise RuntimeError("vision down")

    monkeypatch.setattr(ai_client, "ocr_images", boom)
    captured = {}

    def fake_extract(doc_id, title, text):
        captured["text"] = text
        return fake_facts(doc.id)

    monkeypatch.setattr(ai_client, "extract_document_facts", fake_extract)
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id])
    pipeline.run_job(job.id)
    job.refresh_from_db()
    assert job.status == AiJob.Status.SUCCEEDED
    assert "surviving text" in captured["text"]
    assert job.events.filter(level="warn").exists()


def test_pdf_multi_page_interleaving(user, mock_ai, monkeypatch):
    doc = Document.objects.create(user=user, source_type="pdf", status="processing",
                                  mime_type="application/pdf")
    doc.pdf_path = default_storage.save(f"documents/{user.id}/m.pdf", ContentFile(b"%PDF-1.4 fake"))
    doc.save()
    monkeypatch.setattr(
        extraction, "extract_pdf",
        lambda data, **k: extraction.PdfContent(pages=[
            extraction.PageContent(text="page one text", images=[b"i1"]),
            extraction.PageContent(text="", images=[b"i2"]),  # image-only page (no text layer)
        ]),
    )
    monkeypatch.setattr(ai_client, "ocr_images", lambda imgs, **k: "OCR-" + str(len(imgs)))
    captured = {}

    def fake_extract(doc_id, title, text):
        captured["text"] = text
        return fake_facts(doc.id)

    monkeypatch.setattr(ai_client, "extract_document_facts", fake_extract)
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id])
    pipeline.run_job(job.id)
    job.refresh_from_db()
    assert job.status == AiJob.Status.SUCCEEDED
    t = captured["text"]
    assert t.index("page one text") < t.index("[IMAGE OCR — page 1]") < t.index("[IMAGE OCR — page 2]")
    # page 2 had no text layer -> only its OCR block appears, no page-2 text part
    assert "[IMAGE OCR — page 2]" in t


def _rate_limit_error():
    import httpx
    from openai import RateLimitError
    req = httpx.Request("POST", "https://api.openai.com/v1/responses")
    return RateLimitError("rate limited", response=httpx.Response(429, request=req), body=None)


def test_parse_with_retry_does_not_nudge_on_rate_limit():
    from openai import RateLimitError
    from apps.jobs import ai_client
    calls = {"n": 0}
    def make_call(is_retry):
        calls["n"] += 1
        raise _rate_limit_error()
    with pytest.raises(RateLimitError):
        ai_client._parse_with_retry(make_call)
    assert calls["n"] == 1  # transient API error -> NO corrective-nudge retry


def test_parse_with_retry_nudges_on_schema_error():
    from apps.jobs import ai_client
    calls = {"n": 0}
    def make_call(is_retry):
        calls["n"] += 1
        if not is_retry:
            raise ValueError("schema invalid")
        return "ok"
    assert ai_client._parse_with_retry(make_call) == "ok"
    assert calls["n"] == 2  # non-API error -> one corrective-nudge retry


def test_client_uses_max_retries(monkeypatch):
    import openai
    from apps.jobs import ai_client
    captured = {}
    monkeypatch.setattr(openai, "OpenAI", lambda **kw: captured.update(kw) or object())
    ai_client._client()
    assert captured.get("max_retries") == 4
def _facts_obj(doc_id, **kf_over):
    from apps.jobs.schemas import DocumentFacts
    kf = {"blood_type": None, "allergies": [], "medications": [], "conditions": [],
          "surgeries_procedures": [], "implants_devices": [], "key_labs_vitals": [], "extra_notes": []}
    kf.update(kf_over)
    return DocumentFacts.model_validate({"document_id": str(doc_id), "title": "D", "key_facts": kf,
                                         "timeline_events": [], "confidence_0_to_1": 0.5})


def test_extract_chunked_short_text_single_call(monkeypatch):
    from apps.jobs import ai_client
    calls = {"n": 0}
    def fake(doc_id, title, text):
        calls["n"] += 1
        return _facts_obj(doc_id, blood_type="O+")
    monkeypatch.setattr(ai_client, "extract_document_facts", fake)
    out = ai_client.extract_document_facts_chunked("d1", "T", "short text")
    assert calls["n"] == 1
    assert out.key_facts.blood_type == "O+"


def test_extract_chunked_long_text_merges_all_chunks(monkeypatch):
    from apps.jobs import ai_client
    cap = ai_client.EXTRACT_CHAR_CAP
    text = ("a " * (cap))  # ~2*cap chars -> at least 2 chunks
    seen = {"chunks": 0}
    def fake(doc_id, title, t):
        seen["chunks"] += 1
        # each chunk reports a distinct medication so we can prove nothing is dropped
        return _facts_obj(doc_id, medications=[{"name": f"Med{seen['chunks']}"}])
    monkeypatch.setattr(ai_client, "extract_document_facts", fake)
    out = ai_client.extract_document_facts_chunked("d2", "T", text)
    assert seen["chunks"] >= 2  # the tail was NOT dropped — multiple chunks extracted
    names = sorted(m.name for m in out.key_facts.medications)
    assert names == [f"Med{i}" for i in range(1, seen["chunks"] + 1)]  # all chunks merged
def test_health_profile_has_digest_fields(user):
    from apps.health.models import HealthProfile
    hp = HealthProfile.objects.create(user=user, score=50, score_label="Concerning")
    assert hp.facts_digest == {}
    assert hp.digest_meta == {}


def test_evaluate_accepts_digest_object(monkeypatch):
    from apps.jobs import ai_client
    captured = {}

    class _R:
        def __init__(self, parsed): self.output_parsed = parsed

    class _Parser:
        def parse(self, **kw):
            captured["input"] = kw["input"]
            return _R(fake_evaluation())

    class _Client:
        responses = _Parser()

    monkeypatch.setattr(ai_client, "_client", lambda: _Client())
    digest = {"blood_type": "O+", "allergies": [{"substance": "Penicillin"}], "medications": [],
              "conditions": [], "surgeries_procedures": [], "implants_devices": ["Pacemaker"],
              "key_labs_vitals": [], "extra_notes": [], "recent_timeline": []}
    out = ai_client.evaluate_user_health("u1", digest, {}, manual_profile=None, profile_backfill=None)
    assert out.score_0_to_100 == 78
    user_msg = next(m for m in captured["input"] if m["role"] == "user")["content"]
    assert "Penicillin" in user_msg and "Pacemaker" in user_msg  # digest reached the prompt


def test_evaluate_empty_digest_has_docfacts_false(monkeypatch):
    from apps.jobs import ai_client
    # A 9-key dict with no blood_type and all-empty lists must NOT add the
    # DOCUMENT_FACTS trust-ladder line (the behavioral change vs old len()>0).
    captured = {}

    class _R:
        def __init__(self, parsed): self.output_parsed = parsed

    class _Parser:
        def parse(self, **kw):
            captured["sys"] = kw["input"][0]["content"]
            return _R(fake_evaluation())

    class _Client:
        responses = _Parser()

    monkeypatch.setattr(ai_client, "_client", lambda: _Client())
    empty_digest = {"blood_type": None, "allergies": [], "medications": [], "conditions": [],
                    "surgeries_procedures": [], "implants_devices": [], "key_labs_vitals": [],
                    "extra_notes": [], "recent_timeline": []}
    ai_client.evaluate_user_health("u1", empty_digest, {})
    assert "DOCUMENT_FACTS" not in captured["sys"]


def test_profile_eval_reuses_cached_digest_zero_reads(user, mock_ai, monkeypatch):
    from apps.health.models import HealthProfile
    from apps.jobs import pipeline
    doc = Document.objects.create(user=user, source_type="pdf", status="processing", mime_type="application/pdf")
    doc.pdf_path = default_storage.save(f"documents/{user.id}/d.pdf", ContentFile(b"%PDF-1.4 fake"))
    doc.save()
    monkeypatch.setattr(ai_client, "extract_document_facts", lambda *a, **k: fake_facts(doc.id))
    j1 = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id])
    pipeline.run_job(j1.id)
    hp = HealthProfile.objects.get(user=user)
    assert hp.facts_digest and hp.digest_meta.get("doc_ids")
    # profile-eval job (no new docs) must reuse the digest with ZERO summary reads
    reads = {"n": 0}
    orig = pipeline._read_json
    monkeypatch.setattr(pipeline, "_read_json", lambda key: (reads.__setitem__("n", reads["n"] + 1), orig(key))[1])
    j2 = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROFILE_EVALUATION, document_ids=[])
    pipeline.run_job(j2.id)
    j2.refresh_from_db()
    assert j2.status == AiJob.Status.SUCCEEDED
    assert reads["n"] == 0


def test_digest_card_keeps_blood_type_and_implants(user, mock_ai, monkeypatch):
    from apps.jobs import pipeline
    doc = Document.objects.create(user=user, source_type="pdf", status="processing", mime_type="application/pdf")
    doc.pdf_path = default_storage.save(f"documents/{user.id}/d2.pdf", ContentFile(b"%PDF-1.4 fake"))
    doc.save()
    facts = fake_facts(doc.id, key_facts={"blood_type": "AB-", "allergies": [{"substance": "Penicillin", "severity": "high"}],
        "medications": [], "conditions": [], "surgeries_procedures": [], "implants_devices": ["Stent"],
        "key_labs_vitals": [], "extra_notes": []})
    monkeypatch.setattr(ai_client, "extract_document_facts", lambda *a, **k: facts)
    captured = {}
    def fake_eval(user_id, doc_facts, *a, **k):
        captured["doc_facts"] = doc_facts
        return fake_evaluation()
    monkeypatch.setattr(ai_client, "evaluate_user_health", fake_eval)
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id])
    pipeline.run_job(job.id)
    d = captured["doc_facts"]
    assert isinstance(d, dict)  # the merged digest, not a list
    assert d["blood_type"] == "AB-"
    assert d["implants_devices"] == ["Stent"]
    assert d["allergies"][0]["substance"] == "Penicillin"


def test_digest_blood_type_uses_most_recent_document(user, mock_ai, monkeypatch):
    import json as _json
    from apps.jobs import pipeline
    def _mk(bt, name):
        d = Document.objects.create(user=user, source_type="pdf", status="processed", mime_type="application/pdf")
        facts = {"document_id": str(d.id), "title": name, "confidence_0_to_1": 0.9, "timeline_events": [],
                 "key_facts": {"blood_type": bt, "allergies": [], "medications": [], "conditions": [],
                               "surgeries_procedures": [], "implants_devices": [], "key_labs_vitals": [], "extra_notes": []}}
        d.summary_path = default_storage.save(f"documents/{user.id}/{name}.json", ContentFile(_json.dumps(facts).encode()))
        d.save()
    _mk("A+", "older")
    _mk("O-", "newer")  # created later -> most recent
    captured = {}
    monkeypatch.setattr(ai_client, "evaluate_user_health",
                        lambda uid, doc_facts, *a, **k: (captured.__setitem__("d", doc_facts), fake_evaluation())[1])
    pipeline.run_job(AiJob.objects.create(user=user, job_type=AiJob.JobType.PROFILE_EVALUATION, document_ids=[]).id)
    assert captured["d"]["blood_type"] == "O-"  # most-recent document wins


def test_digest_build_failure_falls_back_to_raw_list(user, mock_ai, monkeypatch):
    from apps.jobs import pipeline, profile_logic
    from apps.health.models import HealthProfile
    doc = Document.objects.create(user=user, source_type="pdf", status="processing", mime_type="application/pdf")
    doc.pdf_path = default_storage.save(f"documents/{user.id}/f.pdf", ContentFile(b"%PDF-1.4 fake")); doc.save()
    monkeypatch.setattr(ai_client, "extract_document_facts", lambda *a, **k: fake_facts(doc.id))
    def _boom(*a, **k): raise RuntimeError("boom")
    monkeypatch.setattr(profile_logic, "build_facts_digest", _boom)
    captured = {}
    monkeypatch.setattr(ai_client, "evaluate_user_health",
                        lambda uid, doc_facts, *a, **k: (captured.__setitem__("d", doc_facts), fake_evaluation())[1])
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id])
    pipeline.run_job(job.id); job.refresh_from_db()
    assert job.status == AiJob.Status.SUCCEEDED
    assert isinstance(captured["d"], list)  # raw-list fallback reached the eval
    hp = HealthProfile.objects.get(user=user)
    assert hp.facts_digest == {} and hp.digest_meta == {}
    assert job.events.filter(level="warn").exists()


def test_suppression_change_forces_rebuild(user, mock_ai, monkeypatch):
    from apps.jobs import pipeline, profile_logic
    doc = Document.objects.create(user=user, source_type="pdf", status="processing", mime_type="application/pdf")
    doc.pdf_path = default_storage.save(f"documents/{user.id}/s.pdf", ContentFile(b"%PDF-1.4 fake")); doc.save()
    monkeypatch.setattr(ai_client, "extract_document_facts", lambda *a, **k: fake_facts(doc.id))
    pipeline.run_job(AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id]).id)
    monkeypatch.setattr(profile_logic, "compute_suppressed_keys",
                        lambda profile: {"allergies": {"penicillin"}, "medications": set(), "conditions": set(), "surgeries": set()})
    reads = {"n": 0}; orig = pipeline._read_json
    monkeypatch.setattr(pipeline, "_read_json", lambda key: (reads.__setitem__("n", reads["n"] + 1), orig(key))[1])
    j2 = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROFILE_EVALUATION, document_ids=[])
    pipeline.run_job(j2.id); j2.refresh_from_db()
    assert j2.status == AiJob.Status.SUCCEEDED
    assert reads["n"] > 0  # suppression changed -> rebuilt (did not reuse cached digest)
def test_pipeline_reindexes_document(user, mock_ai, monkeypatch):
    from apps.jobs import pipeline, index
    doc = Document.objects.create(user=user, source_type="pdf", status="processing", mime_type="application/pdf")
    doc.pdf_path = default_storage.save(f"documents/{user.id}/r.pdf", ContentFile(b"%PDF-1.4 fake"))
    doc.save()
    monkeypatch.setattr(ai_client, "extract_document_facts", lambda *a, **k: fake_facts(doc.id))
    called = {"docs": []}
    monkeypatch.setattr(index, "reindex_document", lambda d, **k: called["docs"].append(d.id))
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id])
    pipeline.run_job(job.id)
    job.refresh_from_db()
    assert job.status == AiJob.Status.SUCCEEDED
    assert doc.id in called["docs"]


def test_pipeline_reindex_failure_is_non_fatal(user, mock_ai, monkeypatch):
    from apps.jobs import pipeline, index
    doc = Document.objects.create(user=user, source_type="pdf", status="processing", mime_type="application/pdf")
    doc.pdf_path = default_storage.save(f"documents/{user.id}/r2.pdf", ContentFile(b"%PDF-1.4 fake"))
    doc.save()
    monkeypatch.setattr(ai_client, "extract_document_facts", lambda *a, **k: fake_facts(doc.id))
    def _boom(d, **k): raise RuntimeError("embed down")
    monkeypatch.setattr(index, "reindex_document", _boom)
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id])
    pipeline.run_job(job.id)
    job.refresh_from_db()
    assert job.status == AiJob.Status.SUCCEEDED  # reindex failure must not fail the job
    assert job.events.filter(level="warn").exists()


def test_detached_docs_excluded_from_digest_query(db):
    """The digest must only union ACTIVE processed docs (detached_at IS NULL)."""
    from django.contrib.auth import get_user_model
    from django.utils import timezone
    from apps.documents.models import Document

    u = get_user_model().objects.create_user(email="dig@example.com", password="Str0ngPass!23")
    active = Document.objects.create(user=u, source_type="pdf", status="processed",
                                     summary_path="documents/x/processed/a/summary.json")
    Document.objects.create(user=u, source_type="pdf", status="processed",
                            summary_path="documents/x/processed/b/summary.json",
                            detached_at=timezone.now())
    ids = list(Document.objects.filter(
        user=u, status=Document.Status.PROCESSED, summary_path__gt="", detached_at__isnull=True
    ).exclude(source_type=Document.SourceType.MANUAL_INPUT).values_list("id", flat=True))
    assert ids == [active.id]


import json as _json


def test_pipeline_verifies_source_quotes(user, mock_ai, monkeypatch):
    doc = Document.objects.create(user=user, source_type="pdf", status="processing", mime_type="application/pdf")
    doc.pdf_path = default_storage.save(f"documents/{user.id}/q.pdf", ContentFile(b"%PDF-1.4 fake"))
    doc.save()

    def facts_with_quotes(*a, **k):
        return fake_facts(doc.id, key_facts={
            "blood_type": None, "allergies": [], "surgeries_procedures": [], "implants_devices": [],
            "key_labs_vitals": [], "extra_notes": [],
            "medications": [{"name": "Metformin", "source_quote": "diabetic patient", "confidence_0_to_1": 0.7}],
            "conditions": [{"name": "Diabetes", "source_quote": "NOT IN THE DOCUMENT", "confidence_0_to_1": 0.6}],
        })
    monkeypatch.setattr(ai_client, "extract_document_facts", facts_with_quotes)

    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS, document_ids=[doc.id])
    pipeline.run_job(job.id)
    doc.refresh_from_db()
    with default_storage.open(doc.summary_path) as fh:
        kf = _json.loads(fh.read())["key_facts"]
    assert kf["medications"][0]["source_quote"] == "diabetic patient"
    assert kf["conditions"][0]["source_quote"] is None
    assert kf["conditions"][0]["confidence_0_to_1"] == 0.6


def test_stale_digest_version_forces_rebuild(user, mock_ai, monkeypatch):
    """A cached digest with an old digest_version must NOT be reused; the pipeline must rebuild it."""
    import json as _json
    from apps.health.models import HealthProfile
    from apps.jobs import pipeline, profile_logic

    # Create a processed document with a stored summary
    doc = Document.objects.create(user=user, source_type="pdf", status="processed", mime_type="application/pdf")
    facts = {
        "document_id": str(doc.id), "title": "Old Doc", "confidence_0_to_1": 0.9,
        "timeline_events": [],
        "key_facts": {"blood_type": "A+", "allergies": [], "medications": [{"name": "Metformin"}],
                      "conditions": [], "surgeries_procedures": [], "implants_devices": [],
                      "key_labs_vitals": [], "extra_notes": []},
    }
    doc.summary_path = default_storage.save(
        f"documents/{user.id}/stale_v.json", ContentFile(_json.dumps(facts).encode())
    )
    doc.save()

    current_doc_ids = sorted([str(doc.id)])
    stale_digest = {"blood_type": "A+", "medications": [{"name": "Metformin"}],
                    "allergies": [], "conditions": [], "surgeries_procedures": [],
                    "implants_devices": [], "key_labs_vitals": [], "extra_notes": [],
                    "recent_timeline": [], "contradictions": [], "source_confidence": None}
    stale_meta = {
        "doc_ids": current_doc_ids,
        "suppression_sig": "{}",
        "digest_version": 1,  # old version — must not reuse
        "built_at": "2025-01-01T00:00:00Z",
    }
    # Pre-seed a HealthProfile with the stale digest
    HealthProfile.objects.create(
        user=user, version="profile_v2", score=70, score_label="Good",
        facts_digest=stale_digest, digest_meta=stale_meta,
        sources={},
    )

    reads = {"n": 0}
    orig = pipeline._read_json
    monkeypatch.setattr(pipeline, "_read_json", lambda key: (reads.__setitem__("n", reads["n"] + 1), orig(key))[1])

    j = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROFILE_EVALUATION, document_ids=[])
    pipeline.run_job(j.id)
    j.refresh_from_db()
    assert j.status == AiJob.Status.SUCCEEDED

    # Digest was rebuilt: _read_json was called (summary files were read)
    assert reads["n"] > 0, "Expected digest rebuild (summary reads), but got zero reads"

    # The persisted digest_meta now carries the current DIGEST_VERSION
    hp = HealthProfile.objects.get(user=user)
    assert hp.digest_meta.get("digest_version") == profile_logic.DIGEST_VERSION
