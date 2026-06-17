"""
Profile context and AI backfill logic.

Ports profileContext.ts and profileBackfill.ts from the Node.js worker.
Normalizes user profiles, extracts backfill candidates, and safely merges
AI-suggested data without overwriting manual entries.

All functions operate on plain dicts/lists (no Django imports).
"""

from datetime import datetime, timezone
from typing import TypedDict, Optional, Set, Dict, List, Any, Union
import re
import uuid


# ─── Type definitions ──────────────────────────────────────────────────────────

class AllergyItem(TypedDict, total=False):
    id: str
    allergen: str
    reaction: str
    severity: str
    type: str


class MedicationItem(TypedDict, total=False):
    id: str
    name: str
    dose: str
    frequency: str


class MedHistoryItem(TypedDict, total=False):
    id: str
    condition: str
    year: str
    notes: str


class SurgeryItem(TypedDict, total=False):
    id: str
    procedure: str
    year: str
    notes: str


class FamilyHistoryItem(TypedDict, total=False):
    id: str
    condition: str
    relation: str
    notes: str


class HospitalizationItem(TypedDict, total=False):
    id: str
    reason: str
    year: str
    notes: str


class SocialHistoryItem(TypedDict, total=False):
    id: str
    category: str
    detail: str


class StoryAnswers(TypedDict, total=False):
    q1: str
    q2: str
    q3: str
    q4: str
    q5: str
    q6: str
    q7: str
    q8: str
    q9: str
    q10: str


class UserProfileRow(TypedDict, total=False):
    """Raw user_profiles row shape for AI context."""
    first_name: Optional[str]
    last_name: Optional[str]
    date_of_birth: Optional[str]  # ISO: YYYY-MM-DD
    sex_or_gender: Optional[str]
    occupation: Optional[str]
    marital_status: Optional[str]
    number_of_children: Optional[int]
    smoking_status: Optional[str]
    alcohol_use: Optional[str]
    exercise_level: Optional[str]
    current_symptoms: Optional[str]
    allergies: Optional[List[AllergyItem]]
    medications: Optional[List[MedicationItem]]
    medical_history: Optional[List[MedHistoryItem]]
    surgical_history: Optional[List[SurgeryItem]]
    family_history: Optional[List[FamilyHistoryItem]]
    hospitalizations: Optional[List[HospitalizationItem]]
    social_history: Optional[List[SocialHistoryItem]]
    story_answers: Optional[StoryAnswers]


class NormalizedAllergy(TypedDict, total=False):
    allergen: str
    reaction: str
    severity: str
    type: str


class NormalizedMedication(TypedDict, total=False):
    name: str
    dose: str
    frequency: str


class NormalizedCondition(TypedDict, total=False):
    condition: str
    year: str
    notes: str


class NormalizedSurgery(TypedDict, total=False):
    procedure: str
    year: str
    notes: str


class NormalizedFamilyHistory(TypedDict, total=False):
    condition: str
    relation: str
    notes: str


class NormalizedHospitalization(TypedDict, total=False):
    reason: str
    year: str
    notes: str


class NormalizedSocialHistory(TypedDict, total=False):
    category: str
    detail: str


class NormalizedStoryAnswer(TypedDict, total=False):
    question: str
    answer: str


class Demographics(TypedDict, total=False):
    full_name: str
    date_of_birth: str
    age_years: int
    sex_or_gender: str
    occupation: str
    marital_status: str
    number_of_children: int


class Lifestyle(TypedDict, total=False):
    smoking_status: str
    alcohol_use: str
    exercise_level: str


class ManualProfileContext(TypedDict, total=False):
    """Stable, AI-ready output of build_manual_profile_context()."""
    demographics: Demographics
    lifestyle: Lifestyle
    current_symptoms: str
    allergies: List[NormalizedAllergy]
    medications: List[NormalizedMedication]
    medical_history: List[NormalizedCondition]
    surgical_history: List[NormalizedSurgery]
    family_history: List[NormalizedFamilyHistory]
    hospitalizations: List[NormalizedHospitalization]
    social_history: List[NormalizedSocialHistory]
    story_context: List[NormalizedStoryAnswer]
    _source: str  # always "user_profiles"
    _has_clinical_data: bool


class AiBackfilledContext(TypedDict, total=False):
    """AI-backfilled items from user_profiles arrays."""
    allergies: List[NormalizedAllergy]
    medications: List[NormalizedMedication]
    medical_history: List[NormalizedCondition]
    surgical_history: List[NormalizedSurgery]


class AiBackfillArrayFieldMeta(TypedDict):
    """Provenance per backfillable array field."""
    source: str  # always "ai"
    job_id: str
    evaluation_id: Optional[str]
    last_backfill_at: str
    added_keys: List[str]
    current_item_ids: List[str]


class AiBackfillMeta(TypedDict, total=False):
    """Top-level ai_backfill_meta stored in user_profiles.ai_backfill_meta (JSONB)."""
    fields: Dict[str, AiBackfillArrayFieldMeta]
    last_backfill_at: str


class BackfillProfileRow(TypedDict, total=False):
    """Subset of user_profiles fields this module reads/writes."""
    allergies: Optional[List[AllergyItem]]
    medications: Optional[List[MedicationItem]]
    medical_history: Optional[List[MedHistoryItem]]
    surgical_history: Optional[List[SurgeryItem]]
    ai_backfill_meta: Optional[AiBackfillMeta]


class BackfillCandidates(TypedDict):
    """What docFacts extracted as AI candidates."""
    allergies: List[AllergyItem]
    medications: List[MedicationItem]
    medical_history: List[MedHistoryItem]
    surgical_history: List[SurgeryItem]


class BackfillSummary(TypedDict, total=False):
    """Summary of what was actually written in one backfill run."""
    fields_updated: List[str]
    items_added: Dict[str, int]
    items_skipped: Dict[str, int]


class SuppressedKeys(TypedDict):
    """Set of normalized keys user has removed after AI backfill."""
    allergies: Set[str]  # norm(allergen)
    medications: Set[str]  # medication_key(name)
    conditions: Set[str]  # norm(condition)
    surgeries: Set[str]  # norm(procedure)


# ─── Story question labels ─────────────────────────────────────────────────────
# Must stay in sync with QUESTIONS in src/screens/App/StoryScreen.tsx.

STORY_QUESTION_LABELS = {
    "q1": "Tell me about your relationships that are the most important to you and why.",
    "q2": "Tell me how you would describe your health approach. What does \"being healthy\" look like to you?",
    "q3": "Tell me about a positive memory you have from childhood. How old were you?",
    "q4": "Tell me about your parents' relationship when you were growing up. How did you feel with them and your siblings?",
    "q5": "What are things you are good at in terms of health, and what are things that are difficult for you?",
    "q6": "How would you describe the season of life you're in right now?",
    "q7": "What roles feel most important to you right now (parent, partner, worker, caregiver, etc.)?",
    "q8": "On a typical day, what takes most of your time and energy?",
    "q9": "If you had an extra free hour most days, how would you honestly want to use it?",
    "q10": "When you hear the word \"health,\" what comes to mind first?",
}


# ─── Private helpers ───────────────────────────────────────────────────────────

def trimmed(s: Optional[str]) -> Optional[str]:
    """Return trimmed string, or None if blank."""
    if s is None:
        return None
    v = s.strip()
    return v if v else None


def safe_arr(val: Any) -> List[Dict[str, Any]]:
    """Coerce a JSONB value to a typed list, filtering out non-object entries."""
    if not isinstance(val, list):
        return []
    return [v for v in val if v is not None and isinstance(v, dict)]


def compute_age(dob: Optional[str]) -> Optional[int]:
    """Compute age in whole years from an ISO YYYY-MM-DD date_of_birth string."""
    if not dob:
        return None
    try:
        birth = datetime.strptime(dob, "%Y-%m-%d").date()
        from datetime import date
        today = date.today()
        age = today.year - birth.year
        if (today.month, today.day) < (birth.month, birth.day):
            age -= 1
        return age if age >= 0 else None
    except (ValueError, AttributeError):
        return None


def present_if_any(obj: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return the object only if at least one value in it is defined."""
    if any(v is not None for v in obj.values()):
        return obj
    return None


def is_ai_backfilled(item_id: Optional[str]) -> bool:
    """Returns True for array items inserted by the AI backfill worker."""
    return isinstance(item_id, str) and item_id.startswith("ai_")


# ─── Key normalization ─────────────────────────────────────────────────────────
# Normalized keys are used only for comparison — they are never stored in the DB.

def norm(s: Optional[str]) -> str:
    """Normalize: lowercase, trim, collapse whitespace."""
    if s is None:
        return ""
    return re.sub(r"\s+", " ", s.lower().strip())


def allergy_key(allergen: str) -> str:
    """Canonical key for an allergy: the allergen name, normalized."""
    return norm(allergen)


def medication_key(name: str) -> str:
    """
    Canonical key for a medication: the name, normalized, with trailing dosage
    stripped so "Metformin 500mg" and "Metformin" are treated as the same drug.
    """
    normalized = norm(name)
    # Strip trailing dosage: e.g., "metformin 500mg" -> "metformin"
    stripped = re.sub(
        r"\s+\d+(\.\d+)?\s*(mg|mcg|ml|g|iu|units?|tabs?|caps?)\b.*",
        "",
        normalized,
        flags=re.IGNORECASE
    )
    return stripped.strip()


def med_history_key(condition: str) -> str:
    """Canonical key for a medical history item: the condition name."""
    return norm(condition)


def surgery_key(procedure: str) -> str:
    """Canonical key for a surgical history item: the procedure name."""
    return norm(procedure)


# ─── Main builder ──────────────────────────────────────────────────────────────

def build_manual_profile_context(row: UserProfileRow) -> ManualProfileContext:
    """
    Convert a raw user_profiles row into a normalized ManualProfileContext.

    - All strings are trimmed; blank strings are omitted.
    - List item `id` fields are stripped.
    - Empty arrays are omitted (None, not []).
    - Story answers include the full question label for AI readability.
    """
    # ── Demographics ────────────────────────────────────────────────────────
    first_name = trimmed(row.get("first_name"))
    last_name = trimmed(row.get("last_name"))
    full_name_parts = [n for n in [first_name, last_name] if n]
    full_name = " ".join(full_name_parts) if full_name_parts else None

    dob = trimmed(row.get("date_of_birth"))
    age = compute_age(dob)
    sex = trimmed(row.get("sex_or_gender"))
    occ = trimmed(row.get("occupation"))
    marital = trimmed(row.get("marital_status"))
    num_children = row.get("number_of_children")
    if not isinstance(num_children, int) or not (0 <= num_children <= 100):
        num_children = None

    demographics: Demographics = {}
    if full_name:
        demographics["full_name"] = full_name
    if dob:
        demographics["date_of_birth"] = dob
    if age is not None:
        demographics["age_years"] = age
    if sex:
        demographics["sex_or_gender"] = sex
    if occ:
        demographics["occupation"] = occ
    if marital:
        demographics["marital_status"] = marital
    if num_children is not None:
        demographics["number_of_children"] = num_children

    # ── Lifestyle ───────────────────────────────────────────────────────────
    lifestyle = present_if_any(
        {
            "smoking_status": trimmed(row.get("smoking_status")),
            "alcohol_use": trimmed(row.get("alcohol_use")),
            "exercise_level": trimmed(row.get("exercise_level")),
        }
    )

    # ── Current symptoms ────────────────────────────────────────────────────
    current_symptoms = trimmed(row.get("current_symptoms"))

    # ── Allergies ───────────────────────────────────────────────────────────
    allergies: List[NormalizedAllergy] = []
    for a in safe_arr(row.get("allergies")):
        if is_ai_backfilled(a.get("id")):
            continue
        allergen = trimmed(a.get("allergen"))
        if not allergen:
            continue
        normalized: NormalizedAllergy = {"allergen": allergen}
        if reaction := trimmed(a.get("reaction")):
            normalized["reaction"] = reaction
        if severity := trimmed(a.get("severity")):
            normalized["severity"] = severity
        if a.get("type") in ("allergy", "intolerance"):
            normalized["type"] = a["type"]
        allergies.append(normalized)

    # ── Medications ─────────────────────────────────────────────────────────
    medications: List[NormalizedMedication] = []
    for m in safe_arr(row.get("medications")):
        if is_ai_backfilled(m.get("id")):
            continue
        name = trimmed(m.get("name"))
        if not name:
            continue
        normalized: NormalizedMedication = {"name": name}
        if dose := trimmed(m.get("dose")):
            normalized["dose"] = dose
        if frequency := trimmed(m.get("frequency")):
            normalized["frequency"] = frequency
        medications.append(normalized)

    # ── Medical history ─────────────────────────────────────────────────────
    medical_history: List[NormalizedCondition] = []
    for h in safe_arr(row.get("medical_history")):
        if is_ai_backfilled(h.get("id")):
            continue
        condition = trimmed(h.get("condition"))
        if not condition:
            continue
        normalized: NormalizedCondition = {"condition": condition}
        if year := trimmed(h.get("year")):
            normalized["year"] = year
        if notes := trimmed(h.get("notes")):
            normalized["notes"] = notes
        medical_history.append(normalized)

    # ── Surgical history ────────────────────────────────────────────────────
    surgical_history: List[NormalizedSurgery] = []
    for s in safe_arr(row.get("surgical_history")):
        if is_ai_backfilled(s.get("id")):
            continue
        procedure = trimmed(s.get("procedure"))
        if not procedure:
            continue
        normalized: NormalizedSurgery = {"procedure": procedure}
        if year := trimmed(s.get("year")):
            normalized["year"] = year
        if notes := trimmed(s.get("notes")):
            normalized["notes"] = notes
        surgical_history.append(normalized)

    # ── Family history ──────────────────────────────────────────────────────
    family_history: List[NormalizedFamilyHistory] = []
    for f in safe_arr(row.get("family_history")):
        condition = trimmed(f.get("condition"))
        if not condition:
            continue
        normalized: NormalizedFamilyHistory = {"condition": condition}
        if relation := trimmed(f.get("relation")):
            normalized["relation"] = relation
        if notes := trimmed(f.get("notes")):
            normalized["notes"] = notes
        family_history.append(normalized)

    # ── Hospitalizations ────────────────────────────────────────────────────
    hospitalizations: List[NormalizedHospitalization] = []
    for h in safe_arr(row.get("hospitalizations")):
        reason = trimmed(h.get("reason"))
        if not reason:
            continue
        normalized: NormalizedHospitalization = {"reason": reason}
        if year := trimmed(h.get("year")):
            normalized["year"] = year
        if notes := trimmed(h.get("notes")):
            normalized["notes"] = notes
        hospitalizations.append(normalized)

    # ── Social history ──────────────────────────────────────────────────────
    social_history: List[NormalizedSocialHistory] = []
    for s in safe_arr(row.get("social_history")):
        category = trimmed(s.get("category"))
        if not category:
            continue
        normalized: NormalizedSocialHistory = {"category": category}
        if detail := trimmed(s.get("detail")):
            normalized["detail"] = detail
        social_history.append(normalized)

    # ── Story answers ───────────────────────────────────────────────────────
    story_context: List[NormalizedStoryAnswer] = []
    story_answers = row.get("story_answers") or {}
    for q_key in ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10"]:
        answer = trimmed(story_answers.get(q_key))
        question = STORY_QUESTION_LABELS.get(q_key)
        if answer and question:
            story_context.append({"question": question, "answer": answer})

    # ── _has_clinical_data ──────────────────────────────────────────────────
    has_clinical_data = bool(
        allergies
        or medications
        or medical_history
        or surgical_history
        or family_history
        or hospitalizations
        or social_history
        or current_symptoms
    )

    # ── Assemble ────────────────────────────────────────────────────────────
    ctx: ManualProfileContext = {
        "demographics": demographics,
        "_source": "user_profiles",
        "_has_clinical_data": has_clinical_data,
    }

    if lifestyle:
        ctx["lifestyle"] = lifestyle
    if current_symptoms:
        ctx["current_symptoms"] = current_symptoms
    if allergies:
        ctx["allergies"] = allergies
    if medications:
        ctx["medications"] = medications
    if medical_history:
        ctx["medical_history"] = medical_history
    if surgical_history:
        ctx["surgical_history"] = surgical_history
    if family_history:
        ctx["family_history"] = family_history
    if hospitalizations:
        ctx["hospitalizations"] = hospitalizations
    if social_history:
        ctx["social_history"] = social_history
    if story_context:
        ctx["story_context"] = story_context

    return ctx


def build_ai_backfilled_context(row: UserProfileRow) -> Optional[AiBackfilledContext]:
    """
    Extract AI-backfilled items from a raw profile row.
    Returns None when no AI-backfilled items exist.
    """
    allergies: List[NormalizedAllergy] = []
    for a in safe_arr(row.get("allergies")):
        if not is_ai_backfilled(a.get("id")):
            continue
        allergen = trimmed(a.get("allergen"))
        if not allergen:
            continue
        normalized: NormalizedAllergy = {"allergen": allergen}
        if reaction := trimmed(a.get("reaction")):
            normalized["reaction"] = reaction
        if severity := trimmed(a.get("severity")):
            normalized["severity"] = severity
        if a.get("type") in ("allergy", "intolerance"):
            normalized["type"] = a["type"]
        allergies.append(normalized)

    medications: List[NormalizedMedication] = []
    for m in safe_arr(row.get("medications")):
        if not is_ai_backfilled(m.get("id")):
            continue
        name = trimmed(m.get("name"))
        if not name:
            continue
        normalized: NormalizedMedication = {"name": name}
        if dose := trimmed(m.get("dose")):
            normalized["dose"] = dose
        if frequency := trimmed(m.get("frequency")):
            normalized["frequency"] = frequency
        medications.append(normalized)

    medical_history: List[NormalizedCondition] = []
    for h in safe_arr(row.get("medical_history")):
        if not is_ai_backfilled(h.get("id")):
            continue
        condition = trimmed(h.get("condition"))
        if not condition:
            continue
        normalized: NormalizedCondition = {"condition": condition}
        if year := trimmed(h.get("year")):
            normalized["year"] = year
        if notes := trimmed(h.get("notes")):
            normalized["notes"] = notes
        medical_history.append(normalized)

    surgical_history: List[NormalizedSurgery] = []
    for s in safe_arr(row.get("surgical_history")):
        if not is_ai_backfilled(s.get("id")):
            continue
        procedure = trimmed(s.get("procedure"))
        if not procedure:
            continue
        normalized: NormalizedSurgery = {"procedure": procedure}
        if year := trimmed(s.get("year")):
            normalized["year"] = year
        if notes := trimmed(s.get("notes")):
            normalized["notes"] = notes
        surgical_history.append(normalized)

    if not (allergies or medications or medical_history or surgical_history):
        return None

    ctx: AiBackfilledContext = {}
    if allergies:
        ctx["allergies"] = allergies
    if medications:
        ctx["medications"] = medications
    if medical_history:
        ctx["medical_history"] = medical_history
    if surgical_history:
        ctx["surgical_history"] = surgical_history

    return ctx


# ─── Backfill candidate extraction ─────────────────────────────────────────────

def extract_backfill_candidates(doc_facts_list: List[Dict[str, Any]]) -> BackfillCandidates:
    """
    Aggregate DocumentFacts from all processed documents into BackfillCandidates.

    Items are deduplicated across documents by normalized primary key before
    returning, so if two documents mention "Penicillin" only one candidate
    is produced.

    AI-inserted item IDs are prefixed with "ai_" to distinguish them from
    user-created items.
    """
    seen_allergies: Set[str] = set()
    seen_meds: Set[str] = set()
    seen_conditions: Set[str] = set()
    seen_surgeries: Set[str] = set()

    allergies: List[AllergyItem] = []
    medications: List[MedicationItem] = []
    medical_history: List[MedHistoryItem] = []
    surgical_history: List[SurgeryItem] = []

    for doc in doc_facts_list:
        kf = doc.get("key_facts", {})

        # ── Allergies ──────────────────────────────────────────────────────
        for a in safe_arr(kf.get("allergies")):
            substance = trimmed(a.get("substance", ""))
            key = norm(substance)
            if not key or key in seen_allergies:
                continue
            seen_allergies.add(key)
            allergies.append(
                {
                    "id": ai_id(),
                    "allergen": substance,
                    "reaction": trimmed(a.get("reaction", "")) or "",
                    "severity": map_severity(a.get("severity", "")),
                    "type": a.get("type") if a.get("type") in ("allergy", "intolerance") else "allergy",
                }
            )

        # ── Medications ────────────────────────────────────────────────────
        for m in safe_arr(kf.get("medications")):
            name = trimmed(m.get("name", ""))
            key = medication_key(name)
            if not key or key in seen_meds:
                continue
            seen_meds.add(key)
            medications.append(
                {
                    "id": ai_id(),
                    "name": name,
                    "dose": trimmed(m.get("dose", "")) or "",
                    "frequency": trimmed(m.get("frequency", "")) or "",
                }
            )

        # ── Conditions → medical_history ───────────────────────────────────
        for c in safe_arr(kf.get("conditions")):
            name = trimmed(c.get("name", ""))
            key = norm(name)
            if not key or key in seen_conditions:
                continue
            seen_conditions.add(key)
            status = trimmed(c.get("status", ""))
            notes = trimmed(c.get("notes", ""))
            combined_notes = ". ".join([n for n in [status, notes] if n])
            medical_history.append(
                {
                    "id": ai_id(),
                    "condition": name,
                    "year": "",
                    "notes": combined_notes,
                }
            )

        # ── Surgeries / procedures → surgical_history ──────────────────────
        for s in safe_arr(kf.get("surgeries_procedures")):
            name = trimmed(s.get("name", ""))
            key = norm(name)
            if not key or key in seen_surgeries:
                continue
            seen_surgeries.add(key)
            surgical_history.append(
                {
                    "id": ai_id(),
                    "procedure": name,
                    "year": trimmed(s.get("when", "")) or "",
                    "notes": trimmed(s.get("notes", "")) or "",
                }
            )

    return {
        "allergies": allergies,
        "medications": medications,
        "medical_history": medical_history,
        "surgical_history": surgical_history,
    }


# ─── Suppression logic ─────────────────────────────────────────────────────────

def compute_suppressed_keys(profile: BackfillProfileRow) -> SuppressedKeys:
    """
    Derive the set of normalized keys the user has deliberately removed after
    they were AI-backfilled. These are keys recorded in ai_backfill_meta.added_keys
    that are no longer present in the current array.

    The result is used by filter_doc_facts_by_suppression to prevent those items
    from resurfacing in future evaluations.
    """
    meta = profile.get("ai_backfill_meta") or {}
    fields_meta = meta.get("fields", {})

    def suppressed(
        field_name: str,
        current_items: Optional[List[Dict[str, Any]]],
        key_fn,
    ) -> Set[str]:
        field_meta = fields_meta.get(field_name, {})
        if not field_meta or not field_meta.get("added_keys"):
            return set()

        current_normalized = set()
        if isinstance(current_items, list):
            for item in current_items:
                current_normalized.add(key_fn(item))

        out = set()
        for key in field_meta.get("added_keys", []):
            if key not in current_normalized:
                out.add(key)
        return out

    return {
        "allergies": suppressed(
            "allergies",
            profile.get("allergies"),
            lambda a: allergy_key(a.get("allergen", "")),
        ),
        "medications": suppressed(
            "medications",
            profile.get("medications"),
            lambda m: medication_key(m.get("name", "")),
        ),
        "conditions": suppressed(
            "medical_history",
            profile.get("medical_history"),
            lambda h: med_history_key(h.get("condition", "")),
        ),
        "surgeries": suppressed(
            "surgical_history",
            profile.get("surgical_history"),
            lambda s: surgery_key(s.get("procedure", "")),
        ),
    }


def filter_doc_facts_by_suppression(
    doc_facts_list: List[Dict[str, Any]], suppressed: SuppressedKeys
) -> List[Dict[str, Any]]:
    """
    Remove suppressed items from DocumentFacts before they reach the evaluator
    or the backfill candidate extractor.

    This ensures a user who deletes an AI-suggested allergy/medication/condition/
    procedure will not see it resurface in future summaries or evaluations.
    """
    any_suppressions = any(
        [
            len(suppressed["allergies"]) > 0,
            len(suppressed["medications"]) > 0,
            len(suppressed["conditions"]) > 0,
            len(suppressed["surgeries"]) > 0,
        ]
    )

    if not any_suppressions:
        return doc_facts_list  # fast path

    result = []
    for doc in doc_facts_list:
        kf = doc.get("key_facts", {})
        filtered_allergies = kf.get("allergies", [])
        filtered_medications = kf.get("medications", [])
        filtered_conditions = kf.get("conditions", [])
        filtered_surgeries = kf.get("surgeries_procedures", [])

        if len(suppressed["allergies"]) > 0:
            filtered_allergies = [
                a
                for a in filtered_allergies
                if norm(a.get("substance", "")) not in suppressed["allergies"]
            ]
        if len(suppressed["medications"]) > 0:
            filtered_medications = [
                m
                for m in filtered_medications
                if medication_key(m.get("name", "")) not in suppressed["medications"]
            ]
        if len(suppressed["conditions"]) > 0:
            filtered_conditions = [
                c
                for c in filtered_conditions
                if norm(c.get("name", "")) not in suppressed["conditions"]
            ]
        if len(suppressed["surgeries"]) > 0:
            filtered_surgeries = [
                s
                for s in filtered_surgeries
                if norm(s.get("name", "")) not in suppressed["surgeries"]
            ]

        if (
            filtered_allergies == kf.get("allergies", [])
            and filtered_medications == kf.get("medications", [])
            and filtered_conditions == kf.get("conditions", [])
            and filtered_surgeries == kf.get("surgeries_procedures", [])
        ):
            result.append(doc)
        else:
            result.append(
                {
                    **doc,
                    "key_facts": {
                        **kf,
                        "allergies": filtered_allergies,
                        "medications": filtered_medications,
                        "conditions": filtered_conditions,
                        "surgeries_procedures": filtered_surgeries,
                    },
                }
            )

    return result


# ─── Canonical-facts digest (fixes the eval re-send-everything problem) ─────────

_LAB_CAP_PER_NAME = 5
_NOTES_CAP = 40
_TIMELINE_CAP = 50


def build_facts_digest(doc_facts_list: List[Dict[str, Any]], suppressed=None) -> Dict[str, Any]:
    """Fold many documents' KeyFacts into ONE bounded, deduped facts object.

    Pass docs oldest->newest: last-wins fields (e.g. blood_type) then reflect the most
    recently processed document.

    `suppressed` is accepted only for call-site symmetry and is intentionally UNUSED:
    suppression is already applied upstream via filter_doc_facts_by_suppression before
    facts reach this function. Do not rely on this argument to filter anything.
    """
    blood_type = None
    allergies, medications, conditions, surgeries = {}, {}, {}, {}
    implants, labs = {}, {}
    notes, notes_seen = [], set()
    timeline = []

    def merge(store, key, entry, optional_fields):
        if not key:
            return
        if key not in store:
            store[key] = {k: v for k, v in entry.items() if v}
        else:
            cur = store[key]
            for f in optional_fields:
                if not cur.get(f) and entry.get(f):
                    cur[f] = entry[f]

    for doc in doc_facts_list:
        if not isinstance(doc, dict):
            continue
        kf = doc.get("key_facts") or {}
        if kf.get("blood_type"):
            blood_type = kf["blood_type"]
        for a in safe_arr(kf.get("allergies")):
            sub = trimmed(a.get("substance"))
            merge(allergies, allergy_key(sub or ""),
                  {"substance": sub, "reaction": trimmed(a.get("reaction")), "severity": a.get("severity")},
                  ["reaction", "severity"])
        for m in safe_arr(kf.get("medications")):
            nm = trimmed(m.get("name"))
            merge(medications, medication_key(nm or ""),
                  {"name": nm, "dose": trimmed(m.get("dose")), "frequency": trimmed(m.get("frequency"))},
                  ["dose", "frequency"])
        for c in safe_arr(kf.get("conditions")):
            nm = trimmed(c.get("name"))
            merge(conditions, med_history_key(nm or ""),
                  {"name": nm, "status": trimmed(c.get("status")), "notes": trimmed(c.get("notes"))},
                  ["status", "notes"])
        for s in safe_arr(kf.get("surgeries_procedures")):
            nm = trimmed(s.get("name"))
            merge(surgeries, surgery_key(nm or ""),
                  {"name": nm, "when": trimmed(s.get("when")), "notes": trimmed(s.get("notes"))},
                  ["when", "notes"])
        for dev in (kf.get("implants_devices") or []):
            dev = trimmed(dev) if isinstance(dev, str) else None
            if dev and norm(dev) not in implants:
                implants[norm(dev)] = dev
        for lv in safe_arr(kf.get("key_labs_vitals")):
            nm = trimmed(lv.get("name"))
            if not nm:
                continue
            entry = {"name": nm, "value": trimmed(lv.get("value")), "when": trimmed(lv.get("when"))}
            bucket = labs.setdefault(norm(nm), [])
            if (entry["value"], entry["when"]) not in {(e["value"], e["when"]) for e in bucket}:
                bucket.append(entry)
        for note in (kf.get("extra_notes") or []):
            note = trimmed(note) if isinstance(note, str) else None
            if note and note.lower() not in notes_seen:
                notes_seen.add(note.lower())
                notes.append(note)
        for ev in (doc.get("timeline_events") or []):
            title = trimmed(ev.get("title"))
            if not title:
                continue
            timeline.append({"occurred_at": ev.get("occurred_at"), "title": title,
                             "event_type": ev.get("event_type"), "summary": trimmed(ev.get("summary"))})

    capped_labs = []
    for items in labs.values():
        capped_labs.extend(sorted(items, key=lambda x: (x.get("when") or ""), reverse=True)[:_LAB_CAP_PER_NAME])

    seen_tl, tl_out = set(), []
    for ev in sorted(timeline, key=lambda e: (e.get("occurred_at") or ""), reverse=True):
        k = (ev.get("occurred_at"), norm(ev.get("title") or ""))
        if k in seen_tl:
            continue
        seen_tl.add(k)
        tl_out.append(ev)

    return {
        "blood_type": blood_type,
        "allergies": list(allergies.values()),
        "medications": list(medications.values()),
        "conditions": list(conditions.values()),
        "surgeries_procedures": list(surgeries.values()),
        "implants_devices": list(implants.values()),
        "key_labs_vitals": capped_labs,
        "extra_notes": notes[:_NOTES_CAP],
        "recent_timeline": tl_out[:_TIMELINE_CAP],
    }


# ─── ID generation and severity mapping ───────────────────────────────────────

def ai_id() -> str:
    """Generate an AI-prefixed item ID. Prefix makes AI-inserted items identifiable."""
    raw_uuid = str(uuid.uuid4()).replace("-", "")
    return f"ai_{raw_uuid[:16]}"


def map_severity(s: Optional[str]) -> str:
    """Map DocumentFacts severity enum to the UI string used by profileMedical.ts."""
    if s == "high":
        return "Severe"
    elif s == "medium":
        return "Moderate"
    elif s == "low":
        return "Mild"
    else:
        return ""


# ─── Core merge logic ──────────────────────────────────────────────────────────

def compute_backfill_patch(
    current: BackfillProfileRow,
    candidates: BackfillCandidates,
    context: Dict[str, Any],  # {job_id: str, evaluation_id: Optional[str]}
) -> Optional[Dict[str, Any]]:
    """
    Compute a safe patch to user_profiles that backfills AI-derived data without
    overwriting any manually entered values.

    Returns None if there is nothing new to add.

    Returns a dict with 'patch' and 'summary' keys:
    - patch: BackfillProfileRow & {ai_backfill_meta}
    - summary: BackfillSummary
    """
    existing_meta: AiBackfillMeta = current.get("ai_backfill_meta") or {
        "fields": {},
        "last_backfill_at": "",
    }

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    patch: BackfillProfileRow = {}
    new_meta: AiBackfillMeta = {
        "fields": {**existing_meta.get("fields", {})},
        "last_backfill_at": now,
    }

    items_added: Dict[str, int] = {}
    items_skipped: Dict[str, int] = {}
    fields_updated: List[str] = []

    # ── Generic array merge ────────────────────────────────────────────────
    def merge_field(
        field_name: str,
        current_items: Optional[List[Dict[str, Any]]],
        candidate_items: List[Dict[str, Any]],
        key_fn,
    ):
        nonlocal patch, new_meta, items_added, items_skipped, fields_updated

        if not candidate_items:
            return

        existing = list(current_items) if isinstance(current_items, list) else []
        field_meta = existing_meta.get("fields", {}).get(field_name, {})
        prior_keys = set(field_meta.get("added_keys", []))
        current_keys = {key_fn(item) for item in existing}

        to_add: List[Dict[str, Any]] = []
        skipped = 0

        for candidate in candidate_items:
            key = key_fn(candidate)
            if not key:
                skipped += 1
                continue
            if key in current_keys:
                # Already in the array — either manual or prior AI addition still present.
                skipped += 1
                continue
            if key in prior_keys:
                # AI added this in a prior run but it's gone now — user deleted it.
                # Respect the deletion: never re-add.
                skipped += 1
                continue

            to_add.append(candidate)
            current_keys.add(key)  # prevent within-batch duplicates

        if not to_add:
            if skipped > 0:
                items_skipped[field_name] = skipped
            return

        patch[field_name] = existing + to_add
        fields_updated.append(field_name)
        items_added[field_name] = len(to_add)
        if skipped > 0:
            items_skipped[field_name] = skipped

        # ── Update provenance for this field ─────────────────────────────
        new_added_keys = list(set(prior_keys) | {key_fn(item) for item in to_add})

        # current_item_ids: retain prior AI IDs still in the array + newly added IDs
        prior_current_ids = set(field_meta.get("current_item_ids", []))
        still_present = [
            item["id"] for item in existing if item.get("id") in prior_current_ids
        ]

        new_meta["fields"][field_name] = {
            "source": "ai",
            "job_id": context.get("job_id", ""),
            "evaluation_id": context.get("evaluation_id"),
            "last_backfill_at": now,
            "added_keys": new_added_keys,
            "current_item_ids": still_present + [item["id"] for item in to_add],
        }

    # ── Run merge per field ────────────────────────────────────────────────
    merge_field(
        "allergies",
        current.get("allergies"),
        candidates["allergies"],
        lambda a: allergy_key(a.get("allergen", "")),
    )
    merge_field(
        "medications",
        current.get("medications"),
        candidates["medications"],
        lambda m: medication_key(m.get("name", "")),
    )
    merge_field(
        "medical_history",
        current.get("medical_history"),
        candidates["medical_history"],
        lambda h: med_history_key(h.get("condition", "")),
    )
    merge_field(
        "surgical_history",
        current.get("surgical_history"),
        candidates["surgical_history"],
        lambda s: surgery_key(s.get("procedure", "")),
    )

    if not fields_updated:
        return None

    patch["ai_backfill_meta"] = new_meta

    return {
        "patch": patch,
        "summary": {
            "fields_updated": fields_updated,
            "items_added": items_added,
            "items_skipped": items_skipped,
        },
    }
