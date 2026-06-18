"""Tests for the extended PHI/secrets sanitizer in apps.jobs.error_sanitizer."""
import pytest
from apps.jobs.error_sanitizer import (
    sanitize_error_message,
    sanitize_log_message,
    sanitize_response_detail,
    validate_timeline_event_data,
)


# ── sanitize_log_message (PHI + secrets) ──────────────────────────────────────

def test_ssn_redacted():
    msg = "Patient SSN 123-45-6789 found in record"
    out = sanitize_log_message(msg)
    assert "123-45-6789" not in out
    assert "[SSN]" in out


def test_email_redacted():
    msg = "Error contacting user@example.com: timeout"
    out = sanitize_log_message(msg)
    assert "user@example.com" not in out
    assert "[EMAIL]" in out


def test_file_path_redacted():
    msg = "Exception in /home/user/rivr/backend/app.py:42"
    out = sanitize_log_message(msg)
    assert "/home/user/rivr/backend/app.py" not in out
    assert "[FILE_PATH]" in out


def test_ip_redacted():
    msg = "Connection from 192.168.1.100 refused"
    out = sanitize_log_message(msg)
    assert "192.168.1.100" not in out
    assert "[IP]" in out


def test_mrn_redacted():
    msg = "MRN: 1234567 patient admitted"
    out = sanitize_log_message(msg)
    assert "1234567" not in out
    assert "[MRN]" in out


def test_max_length_enforced():
    long_msg = "x" * 1000
    out = sanitize_log_message(long_msg, max_length=500)
    assert len(out) <= 500


def test_secrets_still_redacted_by_sanitize_log_message():
    msg = "failed with api_key=sk-proj-verysecretkey1234567890abcdef"
    out = sanitize_log_message(msg)
    assert "sk-proj-" not in out


def test_clean_message_preserved():
    msg = "Database connection failed: host unreachable"
    out = sanitize_log_message(msg)
    assert out == msg


# ── sanitize_error_message (secrets only, original behaviour) ─────────────────

def test_openai_key_still_redacted():
    msg = "sk-proj-1234567890abcdefghijklmnopqrstuvwxyz failed"
    assert "sk-proj-" not in sanitize_error_message(msg)


def test_sanitize_error_message_no_phi_redaction():
    # sanitize_error_message is secrets-only — email should pass through (backward compat)
    msg = "error for user@example.com"
    out = sanitize_error_message(msg)
    # Should NOT redact email (that's sanitize_log_message's job)
    assert "user@example.com" in out


# ── sanitize_response_detail ──────────────────────────────────────────────────

def test_response_detail_sanitizes_detail_key():
    data = {"detail": "File /home/user/app.py not found for user@example.com"}
    out = sanitize_response_detail(data)
    assert "user@example.com" not in out["detail"]
    assert "/home/user/rivr/backend/app.py" not in out.get("detail", "")


def test_response_detail_sanitizes_message_key():
    data = {"message": "Error SSN 123-45-6789 detected"}
    out = sanitize_response_detail(data)
    assert "123-45-6789" not in out["message"]


def test_response_detail_leaves_other_keys_alone():
    data = {"status": "error", "code": "NOT_FOUND"}
    out = sanitize_response_detail(data)
    assert out["status"] == "error"
    assert out["code"] == "NOT_FOUND"


def test_response_detail_handles_list():
    data = [{"detail": "email@test.com failed"}]
    out = sanitize_response_detail(data)
    assert "email@test.com" not in out[0]["detail"]


def test_response_detail_handles_non_dict():
    assert sanitize_response_detail("plain string") == "plain string"
    assert sanitize_response_detail(None) is None


# ── validate_timeline_event_data ──────────────────────────────────────────────

def test_rejects_raw_extracted_text_key():
    with pytest.raises(ValueError, match="raw_extracted_text"):
        validate_timeline_event_data({"raw_extracted_text": "Patient data..."})


def test_rejects_oversized_value():
    with pytest.raises(ValueError, match="2000 chars"):
        validate_timeline_event_data({"notes": "x" * 2001})


def test_rejects_file_path_in_value():
    with pytest.raises(ValueError, match="file path"):
        validate_timeline_event_data({"source": "/home/user/patient.py"})


def test_accepts_normal_data():
    validate_timeline_event_data({
        "summary": "Patient had surgery",
        "metadata": "standard follow-up",
        "custom_field": "some value",
    })


def test_accepts_none():
    validate_timeline_event_data(None)


def test_accepts_empty_dict():
    validate_timeline_event_data({})


def test_accepts_non_string_values():
    # Non-string values (ints, lists, dicts) should not be checked for file paths
    validate_timeline_event_data({"count": 5, "flags": [1, 2, 3], "meta": {"key": "val"}})
