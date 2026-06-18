"""Retry re-validation tests (Task 6).

The retry path drops the structured-output constraint (it just nudges the model
with plain text), so _parse_with_retry must re-validate the result against the
Pydantic schema and reject malformed output instead of passing it through.
"""
import pytest
from pydantic import ValidationError

from apps.jobs import ai_client
from apps.jobs.schemas import DocumentFacts, HealthEvaluation


def _valid_facts():
    return DocumentFacts.model_validate({
        "document_id": "d1", "title": "t",
        "key_facts": {"blood_type": None, "allergies": [], "medications": [], "conditions": [],
                      "surgeries_procedures": [], "implants_devices": [], "key_labs_vitals": [], "extra_notes": []},
        "timeline_events": [], "confidence_0_to_1": 0.9,
    })


def test_first_attempt_valid_passes():
    out = ai_client._parse_with_retry(lambda is_retry: _valid_facts(), schema_class=DocumentFacts)
    assert out.document_id == "d1"


def test_retry_with_valid_output_passes():
    calls = {"n": 0}

    def make_call(is_retry):
        calls["n"] += 1
        if not is_retry:
            raise ValueError("schema invalid")  # forces a retry
        return _valid_facts()

    out = ai_client._parse_with_retry(make_call, schema_class=DocumentFacts)
    assert calls["n"] == 2 and out.document_id == "d1"


def test_retry_with_malformed_output_rejected():
    """A retry that returns an object failing schema validation must raise, not
    silently feed malformed data downstream."""
    class _Bad:
        # missing the required HealthEvaluation fields
        def model_dump(self):
            return {"score_0_to_100": 50}

    def make_call(is_retry):
        if not is_retry:
            raise ValueError("schema invalid")
        return _Bad()

    with pytest.raises((ValidationError, ValueError)):
        ai_client._parse_with_retry(make_call, schema_class=HealthEvaluation)


def test_no_schema_class_skips_revalidation():
    """Back-compat: callers without a schema (existing behavior) are untouched."""
    out = ai_client._parse_with_retry(lambda is_retry: "ok")
    assert out == "ok"


def test_first_attempt_invalid_triggers_retry_then_revalidates():
    """Even if the first attempt parses but fails re-validation, the corrective
    retry runs and its output is re-validated."""
    calls = {"n": 0}

    class _BadFirst:
        def model_dump(self):
            return {"document_id": "d1"}  # missing key_facts/confidence

    def make_call(is_retry):
        calls["n"] += 1
        return _BadFirst() if not is_retry else _valid_facts()

    out = ai_client._parse_with_retry(make_call, schema_class=DocumentFacts)
    assert calls["n"] == 2 and out.document_id == "d1"
