"""Redact credentials and PHI from error text before it is logged or surfaced.

Exceptions from the OpenAI/embeddings SDKs or storage layer can echo back the
request (URL with an api_key query param, an Authorization header, a database
DSN). This strips the secret material while leaving the rest of the message
intact for debugging.

Also redacts PHI patterns (SSN, phone, email, file paths, MRN-like IDs) so
exception text logged to AiJobEvent or Document.processing_error never leaks
patient data.
"""
from __future__ import annotations

import re
from typing import Any

# (pattern, replacement). Order matters: most specific first.
_SECRET_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    # OpenAI keys: sk-proj-... and classic sk-...
    (re.compile(r"sk-proj-[A-Za-z0-9_\-]{8,}"), "[REDACTED_API_KEY]"),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"), "[REDACTED_API_KEY]"),
    # JWTs (three base64url segments) — match before the looser bearer rule.
    (re.compile(r"eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+"), "[REDACTED_JWT]"),
    # Bearer tokens.
    (re.compile(r"Bearer\s+[A-Za-z0-9_\-.=+/]+", re.IGNORECASE), "Bearer [REDACTED_TOKEN]"),
    # AWS access key id and secret access key.
    (re.compile(r"AKIA[0-9A-Z]{16}"), "[REDACTED_AWS_ACCESS_KEY]"),
    (re.compile(
        r"(?:aws_)?secret_access_key\s*[:=]\s*[A-Za-z0-9/+=]{40}", re.IGNORECASE),
        "secret_access_key=[REDACTED_AWS_SECRET]"),
    # api_key / apikey / token / password as a query param or key=value.
    (re.compile(
        r"\b(api[_-]?key|apikey|access[_-]?token|token|password|secret)\b(\s*[:=]\s*)"
        r"[A-Za-z0-9._\-/+]{6,}", re.IGNORECASE),
        r"\1\2[REDACTED]"),
    # Credentials embedded in a DSN: scheme://user:pass@host
    (re.compile(r"(\b[a-z][a-z0-9+.\-]*://[^\s:/@]+:)([^\s@/]+)(@)", re.IGNORECASE),
     r"\1[REDACTED]\3"),
)

# PHI patterns — applied after secrets so they don't interfere.
_PHI_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    # SSN: 123-45-6789 (before phone, since both are digit-and-dash patterns)
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN]"),
    # MRN-like: MRN: 1234567 or MRN 1234567
    (re.compile(r"\bMRN[:\s]+\d{5,10}\b", re.IGNORECASE), "[MRN]"),
    # Email addresses (before file paths to avoid partial matches)
    (re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"), "[EMAIL]"),
    # Phone numbers: +1 (555) 123-4567, 555-123-4567, 555.123.4567, (555) 123 4567.
    # Requires an area-code group + 3 + 4 grouping so it doesn't swallow plain integers.
    (re.compile(
        r"(?<!\d)(?:\+?\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}(?!\d)"),
        "[PHONE]"),
    # File paths containing .py/.js/.ts/.rb/.go/.rs (code paths that leak structure)
    (re.compile(r"(/[a-zA-Z0-9_.\-]+)+\.(py|js|ts|rb|go|rs|java)\b"), "[FILE_PATH]"),
    # IPv4 addresses
    (re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b"), "[IP]"),
)

_ALL_PATTERNS = _SECRET_PATTERNS + _PHI_PATTERNS


def sanitize_error_message(message) -> str:
    """Return ``str(message)`` with any detected credentials redacted."""
    text = message if isinstance(message, str) else str(message)
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def sanitize_log_message(message, max_length: int | None = 500) -> str:
    """Return ``str(message)`` with credentials AND PHI redacted.

    Capped at max_length (default 500) for DB-stored text. Pass max_length=None
    to skip truncation (used for API error responses so client-facing validation
    messages aren't cut off).
    """
    text = message if isinstance(message, str) else str(message)
    for pattern, replacement in _ALL_PATTERNS:
        text = pattern.sub(replacement, text)
    return text if max_length is None else text[:max_length]


def sanitize_response_detail(data: Any) -> Any:
    """Sanitize DRF response data — redacts PHI from string values recursively.

    Handles dicts (sanitizes 'detail'/'message' keys), lists (iterates items),
    and bare strings (ErrorDetail is a str subclass — sanitize directly).
    Called by the custom DRF exception handler so error responses never leak PHI.

    Does NOT truncate — client-facing validation messages must stay intact; only
    the *content* (secrets/PHI) is redacted.
    """
    if isinstance(data, dict):
        result = {}
        for key, value in data.items():
            if key in ("detail", "message") and isinstance(value, str):
                result[key] = sanitize_log_message(value, max_length=None)
            elif isinstance(value, (dict, list)):
                result[key] = sanitize_response_detail(value)
            elif isinstance(value, str):
                # Covers ErrorDetail (str subclass) for non-standard keys
                result[key] = sanitize_log_message(value, max_length=None)
            else:
                result[key] = value
        return result
    if isinstance(data, list):
        return [sanitize_response_detail(item) for item in data]
    if isinstance(data, str):
        # Bare ErrorDetail or string (DRF wraps some errors as a bare list of ErrorDetails)
        return sanitize_log_message(data, max_length=None)
    return data


def validate_timeline_event_data(data: Any) -> None:
    """Validate TimelineEvent.data dict to prevent PHI storage.

    Raises ValueError if:
    - 'raw_extracted_text' key is present (raw OCR output — contains PHI)
    - any string value exceeds 2000 chars
    - any string value contains a code/system file path
    """
    if not data or not isinstance(data, dict):
        return

    if "raw_extracted_text" in data:
        raise ValueError(
            "TimelineEvent.data cannot contain 'raw_extracted_text' key (raw PHI)"
        )

    _path_pattern = re.compile(r"(/[a-zA-Z0-9_.\-]+)+\.(py|js|ts|rb|go|rs|java)\b")
    for key, value in data.items():
        if not isinstance(value, str):
            continue
        if len(value) > 2000:
            raise ValueError(
                f"TimelineEvent.data[{key!r}] exceeds 2000 chars ({len(value)})"
            )
        if _path_pattern.search(value):
            raise ValueError(
                f"TimelineEvent.data[{key!r}] contains a file path"
            )
