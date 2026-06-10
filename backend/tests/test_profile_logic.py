"""Parity tests for the ported AI profile context / backfill / suppression logic."""
from apps.jobs import extraction, profile_logic as pl
from apps.jobs.profile_logic import build_facts_digest
from apps.jobs.schemas import DocumentFacts, HealthEvaluation


def _doc_facts(allergies=None, meds=None, conditions=None, surgeries=None):
    return {
        "document_id": "d1",
        "key_facts": {
            "allergies": allergies or [],
            "medications": meds or [],
            "conditions": conditions or [],
            "surgeries_procedures": surgeries or [],
        },
    }


def test_manual_context_excludes_ai_items():
    row = {
        "first_name": "Ada", "last_name": "Lovelace",
        "allergies": [
            {"id": "u1", "allergen": "Penicillin", "reaction": "rash", "severity": "Mild"},
            {"id": "ai_abc", "allergen": "Latex"},
        ],
    }
    ctx = pl.build_manual_profile_context(row)
    names = [a["allergen"] for a in ctx.get("allergies", [])]
    assert names == ["Penicillin"]  # ai_ item excluded
    assert ctx["demographics"]["full_name"] == "Ada Lovelace"


def test_backfill_candidates_dedupe_and_prefix():
    facts = [
        _doc_facts(allergies=[{"substance": "Penicillin", "severity": "high"}]),
        _doc_facts(allergies=[{"substance": "penicillin", "severity": "low"}]),  # dup by norm
    ]
    cand = pl.extract_backfill_candidates(facts)
    assert len(cand["allergies"]) == 1
    assert cand["allergies"][0]["id"].startswith("ai_")


def test_backfill_patch_skips_manual_and_respects_deletion():
    candidates = pl.extract_backfill_candidates([_doc_facts(meds=[{"name": "Metformin 500mg"}])])
    # Manual profile already has Metformin -> candidate skipped (manual wins).
    current = {"medications": [{"id": "u1", "name": "Metformin"}], "ai_backfill_meta": {"fields": {}}}
    assert pl.compute_backfill_patch(current, candidates, {"job_id": "j1", "evaluation_id": None}) is None

    # Empty profile -> candidate added with ai_ id + provenance recorded.
    res = pl.compute_backfill_patch({"medications": []}, candidates, {"job_id": "j1", "evaluation_id": "e1"})
    assert res is not None
    patch = res["patch"]
    assert patch["medications"][0]["name"] == "Metformin 500mg"
    assert "medications" in patch["ai_backfill_meta"]["fields"]
    added_keys = patch["ai_backfill_meta"]["fields"]["medications"]["added_keys"]
    assert "metformin" in added_keys  # dosage stripped in key

    # User later deleted the AI med -> it must NOT be re-added.
    deleted_state = {"medications": [], "ai_backfill_meta": patch["ai_backfill_meta"]}
    assert pl.compute_backfill_patch(deleted_state, candidates, {"job_id": "j2", "evaluation_id": None}) is None


def test_suppression_removes_deleted_items_from_docfacts():
    # User had an AI-backfilled allergy, then deleted it (added_keys has it, current empty).
    profile = {
        "allergies": [],
        "ai_backfill_meta": {"fields": {"allergies": {"added_keys": ["penicillin"]}}},
    }
    suppressed = pl.compute_suppressed_keys(profile)
    assert "penicillin" in suppressed["allergies"]
    facts = [_doc_facts(allergies=[{"substance": "Penicillin", "severity": "high"}])]
    filtered = pl.filter_doc_facts_by_suppression(facts, suppressed)
    assert filtered[0]["key_facts"]["allergies"] == []  # suppressed, won't resurface


def test_apple_health_snapshot_aggregation():
    events = [  # newest-first; function takes most-recent per metric
        {"event_type": "apple_health_steps", "data": {"steps": 1000}},
        {"event_type": "apple_health_steps", "data": {"value": 3000}},  # older -> ignored
        {"event_type": "apple_health_sleep", "data": {"minutes": 420}},
        {"event_type": "apple_health_resting_hr", "data": {"bpm": 58}},
        {"event_type": "apple_health_resting_hr", "data": {"bpm": 60}},  # older -> ignored
    ]
    snap = extraction.apple_health_snapshot(events)
    assert snap["steps_per_day_7d_avg"] == 1000   # most-recent (first in list)
    assert snap["sleep_min_per_night_7d_avg"] == 420
    assert snap["heart_rate_bpm_latest"] == 58    # most-recent (first in list)


def test_schemas_validate_sample_payloads():
    facts = DocumentFacts.model_validate({
        "document_id": "d1", "title": "Labs",
        "key_facts": {"allergies": [{"substance": "Nuts", "severity": "high"}]},
        "timeline_events": [], "confidence_0_to_1": 0.9,
    })
    assert facts.key_facts.allergies[0].severity == "high"

    ev = HealthEvaluation.model_validate({
        "score_0_to_100": 82, "score_label": "Strong", "overview": "ok",
        "highlights": [], "risk_flags": [], "missing_info": [], "suggested_next_steps": [],
        "recommendations": [], "three_by_five_card": {
            "blood_type": "O+", "emergency_contact": {"name": None, "phone": None},
            "one_line_summary": "Healthy",
        },
        "full_summary_markdown": "...", "disclaimer": "Informational only.",
    })
    assert ev.score_0_to_100 == 82 and ev.three_by_five_card.blood_type == "O+"


def _doc(**kf):
    base = {"blood_type": None, "allergies": [], "medications": [], "conditions": [],
            "surgeries_procedures": [], "implants_devices": [], "key_labs_vitals": [], "extra_notes": []}
    base.update(kf)
    return {"key_facts": base, "timeline_events": []}


def test_digest_dedupes_medications_across_docs():
    docs = [_doc(medications=[{"name": "Metformin 500mg"}]) for _ in range(10)]
    d = build_facts_digest(docs, None)
    assert len(d["medications"]) == 1
    assert d["medications"][0]["name"] == "Metformin 500mg"


def test_digest_blood_type_last_non_null():
    assert build_facts_digest([_doc(blood_type="A+"), _doc(blood_type=None), _doc(blood_type="O-")])["blood_type"] == "O-"
    assert build_facts_digest([_doc(blood_type="A+"), _doc(blood_type=None)])["blood_type"] == "A+"


def test_digest_preserves_all_card_critical_categories():
    docs = [_doc(blood_type="O+", implants_devices=["Pacemaker"],
                 allergies=[{"substance": "Penicillin", "severity": "high", "reaction": "rash"}])]
    d = build_facts_digest(docs, None)
    assert d["blood_type"] == "O+"
    assert d["implants_devices"] == ["Pacemaker"]
    assert d["allergies"][0]["substance"] == "Penicillin"
    assert d["allergies"][0]["severity"] == "high"


def test_digest_merges_richer_fields_on_dup():
    docs = [_doc(allergies=[{"substance": "Penicillin"}]),
            _doc(allergies=[{"substance": "penicillin", "reaction": "hives", "severity": "high"}])]
    d = build_facts_digest(docs, None)
    assert len(d["allergies"]) == 1
    assert d["allergies"][0]["reaction"] == "hives"


def test_digest_caps_labs_to_5_per_name_and_does_not_collapse():
    docs = [_doc(key_labs_vitals=[{"name": "LDL", "value": f"{100+i}", "when": f"2024-0{i+1}-01"}]) for i in range(7)]
    d = build_facts_digest(docs, None)
    ldl = [x for x in d["key_labs_vitals"] if x["name"] == "LDL"]
    assert len(ldl) == 5  # capped, not collapsed to 1
    assert sorted([x["when"] for x in ldl], reverse=True)[0] == "2024-07-01"  # most-recent retained


def test_digest_caps_extra_notes():
    docs = [_doc(extra_notes=[f"note {i}"]) for i in range(50)]
    d = build_facts_digest(docs, None)
    assert len(d["extra_notes"]) == 40


def test_digest_bounds_and_dedupes_timeline():
    docs = [{"key_facts": _doc()["key_facts"],
             "timeline_events": [{"occurred_at": f"2024-01-{(i%28)+1:02d}", "title": f"Visit {i}",
                                  "event_type": "visit", "summary": "x", "tags": [], "data_kv": []}]}
            for i in range(60)]
    d = build_facts_digest(docs, None)
    assert len(d["recent_timeline"]) == 50
    assert set(d["recent_timeline"][0].keys()) == {"occurred_at", "title", "event_type", "summary"}
