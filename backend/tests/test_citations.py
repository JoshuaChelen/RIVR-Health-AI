"""Phase 2B: citation-level provenance (source_quote + per-item confidence)."""
import pytest


def test_item_schemas_accept_quote_and_confidence():
    from apps.jobs.schemas import Allergy, Medication, Condition, SurgeryProcedure
    a = Allergy(substance="Penicillin", severity="high", source_quote="allergy: penicillin", confidence_0_to_1=0.9)
    assert a.source_quote == "allergy: penicillin" and a.confidence_0_to_1 == 0.9
    assert Medication(name="Metformin").source_quote is None
    assert Condition(name="Asthma").confidence_0_to_1 is None
    assert SurgeryProcedure(name="Appendectomy").source_quote is None


def test_item_confidence_range_validated():
    from apps.jobs.schemas import Medication
    with pytest.raises(Exception):
        Medication(name="X", confidence_0_to_1=1.5)


def test_verify_quotes_keeps_present_nulls_absent():
    from apps.jobs.citations import verify_quotes
    text = "Patient takes Metformin 500mg PO BID for diabetes. Allergic to Penicillin."
    kf = {
        "medications": [{"name": "Metformin", "source_quote": "Metformin 500mg PO BID", "confidence_0_to_1": 0.8}],
        "allergies": [{"substance": "Latex", "source_quote": "latex allergy", "confidence_0_to_1": 0.4}],
    }
    out = verify_quotes(kf, text)
    assert out["medications"][0]["source_quote"] == "Metformin 500mg PO BID"
    assert out["medications"][0]["confidence_0_to_1"] == 0.8
    assert out["allergies"][0]["source_quote"] is None
    assert out["allergies"][0]["confidence_0_to_1"] == 0.4


def test_verify_quotes_normalizes_whitespace_and_case():
    from apps.jobs.citations import verify_quotes
    text = "Diagnosis:   ASTHMA   (mild)"
    kf = {"conditions": [{"name": "Asthma", "source_quote": "asthma (mild)"}]}
    assert verify_quotes(kf, text)["conditions"][0]["source_quote"] == "asthma (mild)"


def test_verify_quotes_nulls_all_when_text_empty():
    from apps.jobs.citations import verify_quotes
    kf = {"medications": [{"name": "X", "source_quote": "anything"}]}
    assert verify_quotes(kf, "")["medications"][0]["source_quote"] is None


def test_verify_quotes_ignores_non_reviewable_lists():
    from apps.jobs.citations import verify_quotes
    kf = {"key_labs_vitals": [{"name": "HbA1c", "source_quote": "not checked"}]}
    assert verify_quotes(kf, "some text")["key_labs_vitals"][0]["source_quote"] == "not checked"


def test_strip_citation_fields_removes_quote_and_confidence():
    from apps.jobs.profile_logic import strip_citation_fields
    docs = [{"key_facts": {
        "medications": [{"name": "Metformin", "dose": "500mg", "source_quote": "long quote", "confidence_0_to_1": 0.8}],
        "allergies": [{"substance": "Latex", "source_quote": "q", "confidence_0_to_1": 0.5}],
        "conditions": [], "surgeries_procedures": []}}]
    out = strip_citation_fields(docs)
    m = out[0]["key_facts"]["medications"][0]
    assert "source_quote" not in m and "confidence_0_to_1" not in m
    assert m["name"] == "Metformin" and m["dose"] == "500mg"
    assert "source_quote" not in out[0]["key_facts"]["allergies"][0]
