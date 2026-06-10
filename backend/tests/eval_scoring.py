"""Pure scoring functions for the AI eval harness (extraction recall + card grounding)."""
from apps.jobs.profile_logic import allergy_key, med_history_key, medication_key, norm, surgery_key

# category -> function mapping a fact dict to its canonical key
_CATEGORY_KEY = {
    "allergies": lambda e: allergy_key(e.get("substance", "")),
    "medications": lambda e: medication_key(e.get("name", "")),
    "conditions": lambda e: med_history_key(e.get("name", "")),
    "surgeries_procedures": lambda e: surgery_key(e.get("name", "")),
    "implants_devices": lambda e: norm(e if isinstance(e, str) else e.get("name", "")),
}


def fact_recall(expected_kf: dict, actual_kf: dict) -> dict:
    """Recall of expected key_facts found in actual (matched by canonical key)."""
    per, missing = {}, []
    total_exp = total_found = 0
    for cat, keyfn in _CATEGORY_KEY.items():
        exp = {k for k in (keyfn(x) for x in (expected_kf.get(cat) or [])) if k}
        act = {k for k in (keyfn(x) for x in (actual_kf.get(cat) or [])) if k}
        found = exp & act
        per[cat] = {"expected": len(exp), "found": len(found), "recall": len(found) / len(exp) if exp else 1.0}
        missing += [f"{cat}:{k}" for k in sorted(exp - act)]
        total_exp += len(exp)
        total_found += len(found)
    bt_exp = norm(expected_kf.get("blood_type") or "")
    if bt_exp:
        ok = bt_exp == norm(actual_kf.get("blood_type") or "")
        per["blood_type"] = {"expected": 1, "found": int(ok), "recall": float(ok)}
        total_exp += 1
        total_found += int(ok)
        if not ok:
            missing.append(f"blood_type:{bt_exp}")
    return {"overall_recall": total_found / total_exp if total_exp else 1.0, "per_category": per, "missing": missing}


# 3x5-card field -> (canonical keyfn, source key_facts category, source-name extractor)
_CARD_CHECK = {
    "current_meds": (medication_key, "medications", lambda e: e.get("name", "")),
    "allergies": (allergy_key, "allergies", lambda e: e.get("substance", "")),
    "major_conditions": (med_history_key, "conditions", lambda e: e.get("name", "")),
    "major_surgeries": (surgery_key, "surgeries_procedures", lambda e: e.get("name", "")),
    "implants_devices": (norm, "implants_devices", lambda e: e if isinstance(e, str) else e.get("name", "")),
}


def card_grounding(card: dict, source_kf: dict) -> dict:
    """Every 3x5-card list entry (a string) must trace to a source key_facts entry by canonical key."""
    ungrounded, total, grounded = [], 0, 0
    for field, (keyfn, src_cat, src_name) in _CARD_CHECK.items():
        src_keys = {k for k in (keyfn(src_name(x)) for x in (source_kf.get(src_cat) or [])) if k}
        for entry in (card.get(field) or []):
            total += 1
            k = keyfn(entry)  # card entries are strings
            if k and k in src_keys:
                grounded += 1
            else:
                ungrounded.append(f"{field}:{entry}")
    return {"grounded": grounded, "total": total, "ratio": grounded / total if total else 1.0, "ungrounded": ungrounded}
