"""Computed document → profile provenance.

Provenance is NOT stored. For a processed document we read its immutable
summary.json and join each extracted fact to the user's profile arrays using
the SAME normalized keys the suppression engine uses. The only persisted
per-item state we read is `review_status` / `ai_original` on ai_-id items.
"""
from __future__ import annotations

import json
from typing import Any, Callable

from django.core.files.storage import default_storage

from apps.jobs import profile_logic as pl
from apps.profiles.models import UserProfile


# ── FIELD_MAP ────────────────────────────────────────────────────────────────
# Each entry binds one profile array field to its document key_facts field and
# the key functions used to match them.
class _FieldCfg:
    def __init__(self, profile_field, doc_field, suppressed_bucket,
                 doc_key: Callable, profile_key: Callable, label: Callable):
        self.profile_field = profile_field
        self.doc_field = doc_field
        self.suppressed_bucket = suppressed_bucket
        self.doc_key = doc_key
        self.profile_key = profile_key
        self.label = label


FIELD_MAP: list[_FieldCfg] = [
    _FieldCfg("allergies", "allergies", "allergies",
              lambda f: pl.allergy_key(f.get("substance", "") or ""),
              lambda i: pl.allergy_key(i.get("allergen", "") or ""),
              lambda f: f.get("substance", "") or ""),
    _FieldCfg("medications", "medications", "medications",
              lambda f: pl.medication_key(f.get("name", "") or ""),
              lambda i: pl.medication_key(i.get("name", "") or ""),
              lambda f: f.get("name", "") or ""),
    _FieldCfg("medical_history", "conditions", "conditions",
              lambda f: pl.med_history_key(f.get("name", "") or ""),
              lambda i: pl.med_history_key(i.get("condition", "") or ""),
              lambda f: f.get("name", "") or ""),
    _FieldCfg("surgical_history", "surgeries_procedures", "surgeries",
              lambda f: pl.surgery_key(f.get("name", "") or ""),
              lambda i: pl.surgery_key(i.get("procedure", "") or ""),
              lambda f: f.get("name", "") or ""),
]


def read_summary(summary_path: str) -> dict | None:
    if not summary_path:
        return None
    try:
        with default_storage.open(summary_path) as fh:
            return json.loads(fh.read())
    except Exception:
        return None


def _profile_dict(profile: UserProfile) -> dict:
    return {f.profile_field: (getattr(profile, f.profile_field) or []) for f in FIELD_MAP} | {
        "ai_backfill_meta": profile.ai_backfill_meta or {}}


def compute_contributions(profile: UserProfile, summary: dict) -> list[dict]:
    """For each fact in the document's summary, resolve its current profile state."""
    pdict = _profile_dict(profile)
    suppressed = pl.compute_suppressed_keys(pdict)
    key_facts = (summary or {}).get("key_facts", {}) or {}
    out: list[dict] = []

    for cfg in FIELD_MAP:
        # Index current profile items by normalized key.
        by_key: dict[str, dict] = {}
        for it in pdict[cfg.profile_field]:
            if isinstance(it, dict):
                k = cfg.profile_key(it)
                if k:
                    by_key[k] = it
        for fact in (key_facts.get(cfg.doc_field) or []):
            if not isinstance(fact, dict):
                continue
            key = cfg.doc_key(fact)
            if not key:
                continue
            label = cfg.label(fact)
            item = by_key.get(key)
            if item is not None:
                is_ai = pl.is_ai_backfilled(item.get("id"))
                out.append({
                    "field": cfg.profile_field,
                    "label": label,
                    "fact": fact,
                    "origin": "ai" if is_ai else "manual",
                    "state": (item.get("review_status") or "unreviewed") if is_ai else "present",
                    "profile_item_id": item.get("id"),
                    "ai_original": item.get("ai_original"),
                })
            else:
                rejected = key in suppressed.get(cfg.suppressed_bucket, set())
                out.append({
                    "field": cfg.profile_field,
                    "label": label,
                    "fact": fact,
                    "origin": "ai",
                    "state": "rejected" if rejected else "not_added",
                    "profile_item_id": None,
                    "ai_original": None,
                })
    return out


def build_analysis(user, document) -> dict:
    """Full per-document analysis payload: confidence + raw facts + contributions."""
    summary = read_summary(document.summary_path) or {}
    profile = UserProfile.for_user(user)
    return {
        "document_id": str(document.id),
        "title": document.title,
        "confidence_0_to_1": summary.get("confidence_0_to_1"),
        "key_facts": summary.get("key_facts", {}),
        "timeline_events": summary.get("timeline_events", []),
        "contributions": compute_contributions(profile, summary),
    }
