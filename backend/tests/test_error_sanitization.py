"""Error-sanitizer tests (Task 5): credentials must be redacted from exception
text before it is logged or surfaced."""
from apps.jobs import error_sanitizer


def test_openai_key_redacted():
    msg = "Failed to call OpenAI: sk-proj-1234567890abcdefghijklmnopqrstuvwxyz timeout"
    out = error_sanitizer.sanitize_error_message(msg)
    assert "sk-proj-" not in out
    assert "1234567890abcdefghijklmnopqrstuvwxyz" not in out
    assert "[REDACTED" in out


def test_classic_openai_key_redacted():
    msg = "auth error with key sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD"
    out = error_sanitizer.sanitize_error_message(msg)
    assert "sk-abcdef" not in out


def test_bearer_token_redacted():
    msg = "Authorization failed: Bearer eyJhbG.payloadpart.signaturepart"
    out = error_sanitizer.sanitize_error_message(msg)
    assert "eyJhbG.payloadpart.signaturepart" not in out


def test_jwt_redacted():
    msg = "token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dozjgNryP4J3jVmNHl0w5N"
    out = error_sanitizer.sanitize_error_message(msg)
    assert "eyJhbGciOiJIUzI1NiJ9" not in out


def test_aws_keys_redacted():
    msg = "AWS: AKIAIOSFODNN7EXAMPLE secret_access_key=wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"
    out = error_sanitizer.sanitize_error_message(msg)
    assert "AKIAIOSFODNN7EXAMPLE" not in out
    assert "wJalrXUtnFEMI" not in out


def test_db_url_password_redacted():
    msg = "could not connect to postgres://rivr:supersecret@db:5432/rivr"
    out = error_sanitizer.sanitize_error_message(msg)
    assert "supersecret" not in out


def test_api_key_query_param_redacted():
    msg = "GET https://api.example.com/v1?api_key=abcDEF123456ghiJKL7890 failed"
    out = error_sanitizer.sanitize_error_message(msg)
    assert "abcDEF123456ghiJKL7890" not in out


def test_legitimate_error_preserved():
    msg = "Database connection failed: host unreachable (timeout after 30s)"
    assert error_sanitizer.sanitize_error_message(msg) == msg


def test_non_string_input():
    assert isinstance(error_sanitizer.sanitize_error_message(ValueError("x")), str)
