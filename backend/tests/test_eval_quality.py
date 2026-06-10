import json
import os
from pathlib import Path

import pytest

from tests.eval_scoring import card_grounding, fact_recall

GOLDEN_DIR = Path(__file__).parent / "golden"


def _load_golden():
    return [json.loads(p.read_text()) for p in sorted(GOLDEN_DIR.glob("*.json"))]


def test_fact_recall_perfect_when_actual_matches_expected():
    kf = {"medications": [{"name": "Metformin 500mg"}], "allergies": [{"substance": "Penicillin"}],
          "conditions": [], "surgeries_procedures": [], "implants_devices": [], "blood_type": "O+"}
    r = fact_recall(kf, kf)
    assert r["overall_recall"] == 1.0 and r["missing"] == []


def test_fact_recall_counts_misses_and_dosage_insensitive_meds():
    expected = {"medications": [{"name": "Metformin 500mg"}, {"name": "Aspirin"}],
                "conditions": [{"name": "Diabetes"}]}
    actual = {"medications": [{"name": "Metformin"}], "conditions": []}  # Metformin matches (dosage stripped); Aspirin + Diabetes missing
    r = fact_recall(expected, actual)
    assert r["per_category"]["medications"]["recall"] == 0.5
    assert "medications:aspirin" in r["missing"] and "conditions:diabetes" in r["missing"]


def test_card_grounding_flags_ungrounded_card_fact():
    card = {"current_meds": ["Metformin 500mg", "Warfarin"], "allergies": [], "major_conditions": [],
            "major_surgeries": [], "implants_devices": []}
    source = {"medications": [{"name": "Metformin"}], "allergies": [], "conditions": [],
              "surgeries_procedures": [], "implants_devices": []}
    g = card_grounding(card, source)
    assert g["total"] == 2 and g["grounded"] == 1
    assert g["ungrounded"] == ["current_meds:Warfarin"]  # a card med with no source -> a hallucination flag


def test_golden_fixtures_are_well_formed():
    golden = _load_golden()
    assert len(golden) >= 3
    for fx in golden:
        assert fx["text"].strip() and isinstance(fx["expected_key_facts"], dict)
        assert "medications" in fx["expected_key_facts"]


@pytest.mark.skipif(not os.environ.get("RUN_LIVE_AI"), reason="needs OpenAI quota; run with RUN_LIVE_AI=1")
def test_live_extraction_recall_on_golden_set():
    from apps.jobs import ai_client
    failures = []
    for fx in _load_golden():
        facts = ai_client.extract_document_facts("golden", fx["title"], fx["text"])
        r = fact_recall(fx["expected_key_facts"], facts.model_dump()["key_facts"])
        if r["overall_recall"] < 0.8:
            failures.append((fx["title"], r["overall_recall"], r["missing"]))
    assert not failures, f"extraction recall < 0.8: {failures}"
