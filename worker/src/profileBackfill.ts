/**
 * profileBackfill.ts
 *
 * Safe AI backfill into user_profiles.
 *
 * Rules enforced here:
 *   1. Manual values always win — if a field has any content, AI never overwrites it.
 *   2. AI may only APPEND to array fields. It never modifies or removes existing items.
 *   3. Duplicate detection uses a normalized primary-key comparison (case-insensitive,
 *      whitespace-normalized) so "Penicillin" and "penicillin" are treated as the same item.
 *   4. "Deleted by user" protection: each run records the normalized keys it has ever added
 *      to a field. If a key is in added_keys but not in the current array, the user deleted it
 *      — AI will never re-add it.
 *   5. Backfill is always non-fatal. If it fails, the calling job still succeeds.
 *
 * Backfillable fields (array only):
 *   allergies, medications, medical_history, surgical_history
 *
 * Not backfilled (by design):
 *   - Scalar identity fields: first_name, last_name, date_of_birth, sex_or_gender
 *   - Contact / PII: email, mobile_phone, emergency_contact_*
 *   - Personal context: occupation, marital_status, number_of_children, story_answers
 *   - Lifestyle scalars: smoking_status, alcohol_use, exercise_level
 *     (documents rarely contain reliable machine-readable lifestyle data)
 *   - current_symptoms (time-sensitive; old documents would backfill stale symptoms)
 *   - family_history, hospitalizations, social_history
 *     (DocumentFacts schema does not extract these as structured fields)
 */

import { randomUUID } from "crypto";
import type { DocumentFacts } from "./schemas";

// ─── Provenance types ──────────────────────────────────────────────────────────

/**
 * Stored in user_profiles.ai_backfill_meta per array field.
 *
 * added_keys: every normalized primary key this system has ever AI-inserted
 *   into this field. Persists across runs. Used to detect user deletions.
 *
 * current_item_ids: item IDs (from the user_profiles list) that were AI-inserted
 *   and are still present. Informational — useful for display in a future "AI-suggested"
 *   badge on the UI.
 */
export type AiBackfillArrayFieldMeta = {
  source: "ai";
  job_id: string;
  evaluation_id: string | null;
  last_backfill_at: string;
  added_keys: string[];
  current_item_ids: string[];
};

export type BackfillableArrayField =
  | "allergies"
  | "medications"
  | "medical_history"
  | "surgical_history";

/** The top-level object stored in user_profiles.ai_backfill_meta (JSONB column). */
export type AiBackfillMeta = {
  fields: Partial<Record<BackfillableArrayField, AiBackfillArrayFieldMeta>>;
  last_backfill_at: string;
};

// ─── Profile item types (mirrors src/lib/profileMedical.ts) ───────────────────
// Re-declared here so the worker has no dependency on the React Native app tree.

export type AllergyItem      = { id: string; allergen: string; reaction: string; severity: string };
export type MedicationItem   = { id: string; name: string; dose: string; frequency: string };
export type MedHistoryItem   = { id: string; condition: string; year: string; notes: string };
export type SurgeryItem      = { id: string; procedure: string; year: string; notes: string };

/** The subset of user_profiles fields this module reads and writes. */
export type BackfillProfileRow = {
  allergies?:       AllergyItem[]    | null;
  medications?:     MedicationItem[] | null;
  medical_history?: MedHistoryItem[] | null;
  surgical_history?:SurgeryItem[]    | null;
  ai_backfill_meta?: AiBackfillMeta  | null;
};

// ─── AI candidates (what docFacts extracted) ──────────────────────────────────

export type BackfillCandidates = {
  allergies:       AllergyItem[];
  medications:     MedicationItem[];
  medical_history: MedHistoryItem[];
  surgical_history:SurgeryItem[];
};

/** Summary of what was actually written in one backfill run. */
export type BackfillSummary = {
  fields_updated: BackfillableArrayField[];
  items_added:    Partial<Record<BackfillableArrayField, number>>;
  items_skipped:  Partial<Record<BackfillableArrayField, number>>;
};

/**
 * Normalized keys for items the user has explicitly removed after they were
 * AI-backfilled. Keyed by logical field (conditions/surgeries map to their
 * DocumentFacts equivalents).
 *
 * Built from ai_backfill_meta.fields[field].added_keys minus the normalized
 * keys still present in the current array — requires no new SQL.
 */
export type SuppressedKeys = {
  allergies:  Set<string>;  // norm(allergen)
  medications: Set<string>; // medicationKey(name)
  conditions: Set<string>;  // norm(condition name)
  surgeries:  Set<string>;  // norm(procedure name)
};

// ─── Key normalization ─────────────────────────────────────────────────────────
// Normalized keys are used only for comparison — they are never stored in the DB.

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Canonical key for an allergy: the allergen name, normalized. */
function allergyKey(a: Pick<AllergyItem, "allergen">): string {
  return norm(a.allergen);
}

/**
 * Canonical key for a medication: the name, normalized, with trailing dosage
 * stripped so "Metformin 500mg" and "Metformin" are treated as the same drug.
 */
function medicationKey(m: Pick<MedicationItem, "name">): string {
  return norm(m.name)
    .replace(/\s+\d+(\.\d+)?\s*(mg|mcg|ml|g|iu|units?|tabs?|caps?)\b.*/i, "")
    .trim();
}

/** Canonical key for a medical history item: the condition name. */
function medHistoryKey(h: Pick<MedHistoryItem, "condition">): string {
  return norm(h.condition);
}

/** Canonical key for a surgical history item: the procedure name. */
function surgeryKey(s: Pick<SurgeryItem, "procedure">): string {
  return norm(s.procedure);
}

// ─── Candidate extraction from DocumentFacts ──────────────────────────────────

/**
 * Aggregate DocumentFacts from all processed documents into BackfillCandidates.
 *
 * Items are deduplicated across documents by normalized primary key before
 * returning, so if two documents mention "Penicillin" only one candidate
 * is produced.
 *
 * AI-inserted item IDs are prefixed with "ai_" to distinguish them from
 * user-created items (which use the makeId() format from profileMedical.ts).
 */
export function extractBackfillCandidates(docFacts: DocumentFacts[]): BackfillCandidates {
  const seenAllergies   = new Set<string>();
  const seenMeds        = new Set<string>();
  const seenConditions  = new Set<string>();
  const seenSurgeries   = new Set<string>();

  const allergies:       AllergyItem[]    = [];
  const medications:     MedicationItem[] = [];
  const medical_history: MedHistoryItem[] = [];
  const surgical_history:SurgeryItem[]    = [];

  for (const doc of docFacts) {
    const kf = doc.key_facts;

    // ── Allergies ──────────────────────────────────────────────────────────
    for (const a of kf.allergies ?? []) {
      const key = norm(a.substance);
      if (!key || seenAllergies.has(key)) continue;
      seenAllergies.add(key);
      allergies.push({
        id:       aiId(),
        allergen: a.substance.trim(),
        reaction: a.reaction?.trim() ?? "",
        severity: mapSeverity(a.severity),
      });
    }

    // ── Medications ────────────────────────────────────────────────────────
    for (const m of kf.medications ?? []) {
      const key = medicationKey({ name: m.name });
      if (!key || seenMeds.has(key)) continue;
      seenMeds.add(key);
      medications.push({
        id:        aiId(),
        name:      m.name.trim(),
        dose:      m.dose?.trim()      ?? "",
        frequency: m.frequency?.trim() ?? "",
      });
    }

    // ── Conditions → medical_history ───────────────────────────────────────
    for (const c of kf.conditions ?? []) {
      const key = norm(c.name);
      if (!key || seenConditions.has(key)) continue;
      seenConditions.add(key);
      medical_history.push({
        id:        aiId(),
        condition: c.name.trim(),
        year:      "",
        notes:     [c.status?.trim(), c.notes?.trim()].filter(Boolean).join(". "),
      });
    }

    // ── Surgeries / procedures → surgical_history ──────────────────────────
    for (const s of kf.surgeries_procedures ?? []) {
      const key = norm(s.name);
      if (!key || seenSurgeries.has(key)) continue;
      seenSurgeries.add(key);
      surgical_history.push({
        id:        aiId(),
        procedure: s.name.trim(),
        year:      s.when?.trim()   ?? "",
        notes:     s.notes?.trim() ?? "",
      });
    }
  }

  return { allergies, medications, medical_history, surgical_history };
}

// ─── Suppression ───────────────────────────────────────────────────────────────

/**
 * Derive the set of normalized keys the user has deliberately removed after
 * they were AI-backfilled. These are keys recorded in ai_backfill_meta.added_keys
 * that are no longer present in the current array.
 *
 * The result is used by filterDocFactsBySuppression to prevent those items from
 * resurfacing in future evaluations via historical DOCUMENT_FACTS.
 */
export function computeSuppressedKeys(profile: BackfillProfileRow): SuppressedKeys {
  const meta = profile.ai_backfill_meta;

  function suppressed<T>(
    fieldName: BackfillableArrayField,
    currentItems: T[] | null | undefined,
    keyFn: (item: T) => string
  ): Set<string> {
    const fieldMeta = meta?.fields?.[fieldName];
    if (!fieldMeta || fieldMeta.added_keys.length === 0) return new Set();

    const currentNormalized = new Set(
      (Array.isArray(currentItems) ? currentItems : []).map(keyFn)
    );
    const out = new Set<string>();
    for (const key of fieldMeta.added_keys) {
      if (!currentNormalized.has(key)) out.add(key);
    }
    return out;
  }

  return {
    allergies:   suppressed("allergies",        profile.allergies,        (a) => allergyKey(a as any)),
    medications: suppressed("medications",      profile.medications,      (m) => medicationKey(m as any)),
    conditions:  suppressed("medical_history",  profile.medical_history,  (h) => medHistoryKey(h as any)),
    surgeries:   suppressed("surgical_history", profile.surgical_history, (s) => surgeryKey(s as any)),
  };
}

/**
 * Remove suppressed items from DocumentFacts before they reach the evaluator or
 * the backfill candidate extractor.
 *
 * This ensures a user who deletes an AI-suggested allergy/medication/condition/
 * procedure will not see it resurface in future summaries, risk flags, or the 3×5
 * card via historical document analysis.
 */
export function filterDocFactsBySuppression(
  docFacts: DocumentFacts[],
  suppressed: SuppressedKeys
): DocumentFacts[] {
  const anySuppressions =
    suppressed.allergies.size > 0 ||
    suppressed.medications.size > 0 ||
    suppressed.conditions.size > 0 ||
    suppressed.surgeries.size > 0;

  if (!anySuppressions) return docFacts; // fast path — nothing to filter

  return docFacts.map((doc) => {
    const kf = doc.key_facts;
    const filteredAllergies = suppressed.allergies.size > 0
      ? kf.allergies.filter((a) => !suppressed.allergies.has(norm(a.substance)))
      : kf.allergies;
    const filteredMedications = suppressed.medications.size > 0
      ? kf.medications.filter((m) => !suppressed.medications.has(medicationKey({ name: m.name })))
      : kf.medications;
    const filteredConditions = suppressed.conditions.size > 0
      ? kf.conditions.filter((c) => !suppressed.conditions.has(norm(c.name)))
      : kf.conditions;
    const filteredSurgeries = suppressed.surgeries.size > 0
      ? kf.surgeries_procedures.filter((s) => !suppressed.surgeries.has(norm(s.name)))
      : kf.surgeries_procedures;

    if (
      filteredAllergies === kf.allergies &&
      filteredMedications === kf.medications &&
      filteredConditions === kf.conditions &&
      filteredSurgeries === kf.surgeries_procedures
    ) {
      return doc; // no changes for this doc — return as-is
    }

    return {
      ...doc,
      key_facts: {
        ...kf,
        allergies:            filteredAllergies,
        medications:          filteredMedications,
        conditions:           filteredConditions,
        surgeries_procedures: filteredSurgeries,
      },
    };
  });
}

/** Generate an AI-prefixed item ID. Prefix makes AI-inserted items identifiable. */
function aiId(): string {
  return `ai_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Map DocumentFacts severity enum to the UI string used by profileMedical.ts. */
function mapSeverity(s: string): string {
  switch (s) {
    case "high":    return "Severe";
    case "medium":  return "Moderate";
    case "low":     return "Mild";
    default:        return "";
  }
}

// ─── Core merge logic ──────────────────────────────────────────────────────────

/**
 * Compute a safe patch to user_profiles that backfills AI-derived data without
 * overwriting any manually entered values.
 *
 * Returns null if there is nothing new to add.
 */
export function computeBackfillPatch(
  current: BackfillProfileRow,
  candidates: BackfillCandidates,
  context: { job_id: string; evaluation_id: string | null }
): {
  patch: BackfillProfileRow & { ai_backfill_meta: AiBackfillMeta };
  summary: BackfillSummary;
} | null {

  const existingMeta: AiBackfillMeta = current.ai_backfill_meta
    ?? { fields: {}, last_backfill_at: "" };

  const now = new Date().toISOString();

  const patch: BackfillProfileRow = {};
  const newMeta: AiBackfillMeta = {
    fields: { ...existingMeta.fields },
    last_backfill_at: now,
  };

  const itemsAdded:   Partial<Record<BackfillableArrayField, number>> = {};
  const itemsSkipped: Partial<Record<BackfillableArrayField, number>> = {};
  const fieldsUpdated: BackfillableArrayField[] = [];

  // ── Generic array merge ────────────────────────────────────────────────────
  function mergeField<T extends { id: string }>(
    fieldName: BackfillableArrayField,
    currentItems: T[] | null | undefined,
    candidateItems: T[],
    keyFn: (item: T) => string
  ) {
    if (candidateItems.length === 0) return;

    const existing    = Array.isArray(currentItems) ? currentItems : [];
    const fieldMeta   = existingMeta.fields[fieldName];
    const priorKeys   = new Set<string>(fieldMeta?.added_keys ?? []);
    const currentKeys = new Set(existing.map(keyFn));

    const toAdd: T[] = [];
    let   skipped = 0;

    for (const candidate of candidateItems) {
      const key = keyFn(candidate);
      if (!key)                { skipped++; continue; }
      if (currentKeys.has(key)) {
        // Already in the array — either manual or a prior AI addition still present.
        skipped++;
        continue;
      }
      if (priorKeys.has(key)) {
        // AI added this in a prior run but it's gone now — user deleted it.
        // Respect the deletion: never re-add.
        skipped++;
        continue;
      }

      toAdd.push(candidate);
      currentKeys.add(key); // prevent within-batch duplicates
    }

    if (toAdd.length === 0) {
      if (skipped > 0) itemsSkipped[fieldName] = skipped;
      return;
    }

    (patch as any)[fieldName] = [...existing, ...toAdd];
    fieldsUpdated.push(fieldName);
    itemsAdded[fieldName]   = toAdd.length;
    if (skipped > 0) itemsSkipped[fieldName] = skipped;

    // ── Update provenance for this field ─────────────────────────────────
    const newAddedKeys = [...new Set([...priorKeys, ...toAdd.map(keyFn)])];

    // current_item_ids: retain prior AI IDs still in the array + newly added IDs
    const priorCurrentIds = new Set(fieldMeta?.current_item_ids ?? []);
    const stillPresent = existing
      .filter((item) => priorCurrentIds.has(item.id))
      .map((item) => item.id);

    newMeta.fields[fieldName] = {
      source:           "ai",
      job_id:           context.job_id,
      evaluation_id:    context.evaluation_id,
      last_backfill_at: now,
      added_keys:       newAddedKeys,
      current_item_ids: [...stillPresent, ...toAdd.map((item) => item.id)],
    };
  }

  // ── Run merge per field ────────────────────────────────────────────────────
  mergeField("allergies",        current.allergies,        candidates.allergies,        (a) => allergyKey(a));
  mergeField("medications",      current.medications,      candidates.medications,      (m) => medicationKey(m));
  mergeField("medical_history",  current.medical_history,  candidates.medical_history,  (h) => medHistoryKey(h));
  mergeField("surgical_history", current.surgical_history, candidates.surgical_history, (s) => surgeryKey(s));

  if (fieldsUpdated.length === 0) return null;

  return {
    patch: { ...patch, ai_backfill_meta: newMeta },
    summary: { fields_updated: fieldsUpdated, items_added: itemsAdded, items_skipped: itemsSkipped },
  };
}
