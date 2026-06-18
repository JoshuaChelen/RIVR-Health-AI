"""Output validation for AI-extracted health data before profile mutation.

The AI pipeline turns untrusted document text into "backfill candidates" that are
written into the user's permanent medical profile (see
profile_logic.extract_backfill_candidates -> compute_backfill_patch, applied in
pipeline.py). A malicious or OCR-corrupted document could otherwise push fabricated
or dangerous values (script payloads, control characters, prompt-injection text,
absurdly long strings) straight into the record.

This module is the gate. It enforces, per candidate type:
  - an allow-list of fields (unknown keys are dropped, not trusted),
  - generous length caps (legit drug names/doses/notes fit comfortably),
  - a narrow deny-list: ASCII control characters, HTML/script-like markup, and
    clusters of prompt-injection phrases.

The deny-list is deliberately narrow so normal clinical text survives untouched:
dosages ("500 mg", "2.5-5 mg"), ranges/operators ("<150", ">120/80"), units,
percentages, punctuation, and free-text notes all pass. We reject the angle-bracket
markup itself (``<script``, ``<img ... onerror=``) — not the comparison characters
that appear in ordinary medical writing.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List


class OutputValidationError(ValueError):
    """Raised when an AI-extracted candidate fails validation. Callers treat the
    whole batch as untrustworthy and skip the backfill (non-fatal)."""


# Generous per-field character caps. Real values are far shorter; these only stop
# field-flooding / DoS, never legitimate text.
_FIELD_CAP = 5000

# Allow-listed fields per candidate type (everything else is dropped).
_ALLERGY_FIELDS = ("id", "allergen", "reaction", "severity", "type")
_MED_FIELDS = ("id", "name", "dose", "frequency")
_CONDITION_FIELDS = ("id", "condition", "year", "notes")
_SURGERY_FIELDS = ("id", "procedure", "year", "notes")

# severity is the mapped UI string from profile_logic.map_severity.
_ALLOWED_SEVERITY = {"", "Severe", "Moderate", "Mild"}
_ALLOWED_ALLERGY_TYPE = {"allergy", "intolerance"}

# HTML / XSS markup. We match the markup tokens, not bare comparison operators, so
# medical text like "<150" or ">120/80" is never flagged.
_HTML_PATTERNS = (
    re.compile(r"<\s*/?\s*(script|iframe|object|embed|svg|img|a|style|link)\b", re.IGNORECASE),
    re.compile(r"javascript:", re.IGNORECASE),
    re.compile(r"\bon\w+\s*=", re.IGNORECASE),  # onclick=, onerror=, onload=, ...
    re.compile(r"</\s*\w+\s*>"),                 # any closing tag e.g. </script>
)

# Prompt-injection phrases. A field is rejected only with 2+ matches, so a lone
# everyday word ("ignore", "rules") in a clinical note never trips it. Stored in
# normalized form (alnum + single spaces) to match normalize_for_phrase_match.
_INJECTION_PHRASES = (
    "ignore previous", "ignore all", "ignore the above", "disregard previous",
    "disregard all", "override", "new instructions", "new rules", "new prompt",
    "previous instructions", "system prompt", "output the", "reveal the",
    "you are now", "act as", "forget everything", "jailbreak", "do not follow",
    "dont follow", "stop following",
)

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_NON_ALNUM_RUN = re.compile(r"[^a-z0-9]+")


def normalize_for_phrase_match(text: str) -> str:
    """Collapse every run of non-alphanumeric characters (whitespace, punctuation,
    soft hyphens, slashes, repeated spaces, zero-width chars) into a single space.

    This defeats trivial bypasses of substring phrase matching: "ignore/previous",
    "ignore  previous", "ignore­previous" all normalize to "ignore previous".
    The phrase list itself is space-separated, so matching on this normalized form
    is equivalent to flexible-separator word-boundary matching.
    """
    return _NON_ALNUM_RUN.sub(" ", (text or "").lower()).strip()


def count_injection_phrases(text: str) -> int:
    """Number of distinct injection phrases present in `text` (bypass-resistant)."""
    norm = " " + normalize_for_phrase_match(text) + " "
    return sum(1 for p in _INJECTION_PHRASES if f" {p} " in norm)


def _check_value(field: str, value: Any) -> str:
    """Validate one string field; return it unchanged when clean.

    Shared content gate used by the AI-backfill validator AND the manual
    profile / ai-item edit paths (same calibrated rules), so legit clinical
    values like "500 mg" or "hives & itching" always pass.
    """
    if value is None:
        return ""
    if not isinstance(value, str):
        # Candidates only ever carry strings here; anything else is malformed.
        raise OutputValidationError(f"{field}: expected string, got {type(value).__name__}")
    if len(value) > _FIELD_CAP:
        raise OutputValidationError(f"{field}: value exceeds {_FIELD_CAP} chars")
    if _CONTROL_CHARS.search(value):
        raise OutputValidationError(f"{field}: control characters not allowed")
    for pat in _HTML_PATTERNS:
        if pat.search(value):
            raise OutputValidationError(f"{field}: HTML/script markup not allowed")
    if count_injection_phrases(value) >= 2:
        raise OutputValidationError(f"{field}: prompt-injection pattern detected")
    return value


def _validate_item(item: Dict[str, Any], allowed_fields: tuple, required: str) -> Dict[str, Any]:
    if not isinstance(item, dict):
        raise OutputValidationError("candidate is not an object")
    if not (isinstance(item.get(required), str) and item[required].strip()):
        raise OutputValidationError(f"missing required field: {required}")
    out: Dict[str, Any] = {}
    for field in allowed_fields:
        if field == "id":
            # IDs are generated server-side (ai_<hex>); keep verbatim, no scanning.
            if item.get("id"):
                out["id"] = item["id"]
            continue
        out[field] = _check_value(field, item.get(field, ""))
    return out


def validate_backfill_candidates(candidates: Dict[str, List[Dict[str, Any]]]) -> Dict[str, List[Dict[str, Any]]]:
    """Validate the BackfillCandidates dict before it mutates the profile.

    Returns a structurally-identical dict of validated items. Raises
    OutputValidationError on the first offending value so the caller can skip the
    whole (untrustworthy) batch.
    """
    candidates = candidates or {}
    validated: Dict[str, List[Dict[str, Any]]] = {
        "allergies": [], "medications": [], "medical_history": [], "surgical_history": [],
    }

    for a in candidates.get("allergies", []) or []:
        item = _validate_item(a, _ALLERGY_FIELDS, "allergen")
        if item.get("severity", "") not in _ALLOWED_SEVERITY:
            raise OutputValidationError(f"severity: invalid value {item.get('severity')!r}")
        if item.get("type", "allergy") not in _ALLOWED_ALLERGY_TYPE:
            raise OutputValidationError(f"type: invalid value {item.get('type')!r}")
        validated["allergies"].append(item)

    for m in candidates.get("medications", []) or []:
        validated["medications"].append(_validate_item(m, _MED_FIELDS, "name"))

    for c in candidates.get("medical_history", []) or []:
        validated["medical_history"].append(_validate_item(c, _CONDITION_FIELDS, "condition"))

    for s in candidates.get("surgical_history", []) or []:
        validated["surgical_history"].append(_validate_item(s, _SURGERY_FIELDS, "procedure"))

    return validated
