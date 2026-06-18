"""Cost-control tests (Task 4): every LLM call passes a token cap.

This SDK's Responses API uses ``max_output_tokens`` (verified: openai 1.109.1 —
``responses.parse``/``responses.create`` accept ``max_output_tokens``, not
``max_tokens``). Caps are generous so legitimate structured output never truncates.
"""
from unittest.mock import Mock, patch

from apps.jobs import ai_client


def _parse_kwargs(fn, *args, **kwargs):
    with patch("apps.jobs.ai_client._client") as mock_client:
        resp = Mock()
        resp.output_parsed = Mock()
        resp.output_text = "text"
        mock_client.return_value.responses.parse.return_value = resp
        mock_client.return_value.responses.create.return_value = resp
        try:
            fn(*args, **kwargs)
        except Exception:
            pass
        parse = mock_client.return_value.responses.parse
        create = mock_client.return_value.responses.create
        call = parse.call_args if parse.call_args else create.call_args
        return call.kwargs if call else {}


def test_extract_passes_max_output_tokens(settings):
    settings.AI_EXTRACT_MAX_TOKENS = 4000
    kw = _parse_kwargs(ai_client.extract_document_facts, "doc_1", "Title", "Patient has asthma.")
    assert kw.get("max_output_tokens") == 4000


def test_eval_passes_max_output_tokens(settings):
    settings.AI_EVAL_MAX_TOKENS = 8000
    kw = _parse_kwargs(ai_client.evaluate_user_health, "user_1", {"allergies": [{"substance": "x"}]}, {})
    assert kw.get("max_output_tokens") == 8000


def test_qa_passes_max_output_tokens(settings):
    settings.AI_QA_MAX_TOKENS = 2000
    kw = _parse_kwargs(ai_client.answer_health_question, "question?", "context", [])
    assert kw.get("max_output_tokens") == 2000


def test_ocr_passes_max_output_tokens(settings):
    settings.AI_OCR_MAX_TOKENS = 4000
    kw = _parse_kwargs(ai_client._ocr_batch, [b"\x89PNG fake"])
    assert kw.get("max_output_tokens") == 4000


def test_defaults_are_generous():
    """Defaults exist and are large enough not to truncate real structured output."""
    from django.conf import settings as dj
    assert dj.AI_EXTRACT_MAX_TOKENS >= 4000
    assert dj.AI_EVAL_MAX_TOKENS >= 8000
    assert dj.AI_QA_MAX_TOKENS >= 1500
    assert dj.AI_OCR_MAX_TOKENS >= 3000


def test_transcription_truncated_to_cap(settings):
    """Whisper output over the cap is truncated before it feeds extraction (#5)."""
    settings.AI_TRANSCRIBE_MAX_CHARS = 100

    class _Tx:
        text = "word " * 1000  # ~5000 chars

    with patch("apps.jobs.ai_client._client") as mock_client:
        mock_client.return_value.audio.transcriptions.create.return_value = _Tx()
        out = ai_client.transcribe_audio(b"fake-audio-bytes", "audio/m4a")
    assert len(out) == 100


def test_transcription_short_unchanged(settings):
    settings.AI_TRANSCRIBE_MAX_CHARS = 50000

    class _Tx:
        text = "Patient reports mild headache for 3 days."

    with patch("apps.jobs.ai_client._client") as mock_client:
        mock_client.return_value.audio.transcriptions.create.return_value = _Tx()
        out = ai_client.transcribe_audio(b"fake-audio-bytes", "audio/m4a")
    assert out == "Patient reports mild headache for 3 days."
