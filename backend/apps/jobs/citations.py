"""Verify per-item source quotes against the document text.

A quote is kept only if it actually appears in the source text (normalized
whitespace + case); otherwise it is nulled so the record never shows a quote
that isn't provably in the document. Confidence is never touched.
"""
from .profile_logic import norm

# Only the user-reviewed item lists carry citations.
_REVIEWABLE = ("allergies", "medications", "conditions", "surgeries_procedures")


def verify_quotes(key_facts: dict, text: str) -> dict:
    if not isinstance(key_facts, dict):
        return key_facts
    haystack = norm(text or "")
    for list_name in _REVIEWABLE:
        for item in key_facts.get(list_name) or []:
            if not isinstance(item, dict):
                continue
            quote = item.get("source_quote")
            if quote and (not haystack or norm(quote) not in haystack):
                item["source_quote"] = None
    return key_facts
