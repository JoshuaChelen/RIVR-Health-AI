"""Redact credentials from error text before it is logged or surfaced.

Exceptions from the OpenAI/embeddings SDKs or storage layer can echo back the
request (URL with an api_key query param, an Authorization header, a database
DSN). This strips the secret material while leaving the rest of the message
intact for debugging.
"""
from __future__ import annotations

import re

# (pattern, replacement). Order matters: most specific first.
_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
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


def sanitize_error_message(message) -> str:
    """Return ``str(message)`` with any detected credentials redacted."""
    text = message if isinstance(message, str) else str(message)
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text
