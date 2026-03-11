/**
 * profileContext.ts
 *
 * Normalizes a raw user_profiles row into a clean, stable ManualProfileContext
 * object suitable for AI evaluation prompts and future provenance logic.
 *
 * Design rules:
 *   - Trim all strings; treat empty string same as null (omit it).
 *   - Strip list-item `id` fields — they are client-side UUIDs, not clinical data.
 *   - Emergency contact is excluded: it is operational/logistics data, not
 *     clinically relevant to health evaluation.
 *   - _has_clinical_data flags whether the context carries any structured medical
 *     data, letting callers decide whether to send it to the AI at all.
 *   - _source enables future provenance checks (AI backfill must not overwrite
 *     fields that already have a "user_profiles" provenance marker).
 */

// ─── Re-declared item types ────────────────────────────────────────────────────
// The worker is a separate Node.js process and cannot import from src/lib/.
// These must stay in sync with src/lib/profileMedical.ts.

export type AllergyItem = {
  id: string;
  allergen: string;
  reaction: string;
  severity: string; // Mild | Moderate | Severe | ""
};

export type MedicationItem = {
  id: string;
  name: string;
  dose: string;
  frequency: string;
};

export type MedHistoryItem = {
  id: string;
  condition: string;
  year: string;
  notes: string;
};

export type SurgeryItem = {
  id: string;
  procedure: string;
  year: string;
  notes: string;
};

export type FamilyHistoryItem = {
  id: string;
  condition: string;
  relation: string;
  notes: string;
};

export type HospitalizationItem = {
  id: string;
  reason: string;
  year: string;
  notes: string;
};

export type SocialHistoryItem = {
  id: string;
  category: string;
  detail: string;
};

export type StoryAnswers = {
  q1?: string; q2?: string; q3?: string; q4?: string; q5?: string;
  q6?: string; q7?: string; q8?: string; q9?: string; q10?: string;
};

// ─── Raw DB row shape ──────────────────────────────────────────────────────────
// Only the fields relevant to AI context. Timestamps, contact info, and
// internal IDs are intentionally excluded.

export type UserProfileRow = {
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;        // ISO: YYYY-MM-DD
  sex_or_gender?: string | null;
  occupation?: string | null;
  marital_status?: string | null;
  number_of_children?: number | null;
  smoking_status?: string | null;
  alcohol_use?: string | null;
  exercise_level?: string | null;
  current_symptoms?: string | null;
  allergies?: AllergyItem[] | null;
  medications?: MedicationItem[] | null;
  medical_history?: MedHistoryItem[] | null;
  surgical_history?: SurgeryItem[] | null;
  family_history?: FamilyHistoryItem[] | null;
  hospitalizations?: HospitalizationItem[] | null;
  social_history?: SocialHistoryItem[] | null;
  story_answers?: StoryAnswers | null;
};

// ─── Normalized item types (id stripped, empty fields omitted) ─────────────────

export type NormalizedAllergy = {
  allergen: string;
  reaction?: string;
  severity?: string;
};

export type NormalizedMedication = {
  name: string;
  dose?: string;
  frequency?: string;
};

export type NormalizedCondition = {
  condition: string;
  year?: string;
  notes?: string;
};

export type NormalizedSurgery = {
  procedure: string;
  year?: string;
  notes?: string;
};

export type NormalizedFamilyHistory = {
  condition: string;
  relation?: string;
  notes?: string;
};

export type NormalizedHospitalization = {
  reason: string;
  year?: string;
  notes?: string;
};

export type NormalizedSocialHistory = {
  category: string;
  detail?: string;
};

export type NormalizedStoryAnswer = {
  question: string;
  answer: string;
};

// ─── ManualProfileContext ──────────────────────────────────────────────────────
// The stable, AI-ready output of buildManualProfileContext().

export type ManualProfileContext = {
  demographics: {
    full_name?: string;
    date_of_birth?: string;
    age_years?: number;
    sex_or_gender?: string;
    occupation?: string;
    marital_status?: string;
    number_of_children?: number;
  };

  lifestyle?: {
    smoking_status?: string;
    alcohol_use?: string;
    exercise_level?: string;
  };

  current_symptoms?: string;

  allergies?: NormalizedAllergy[];
  medications?: NormalizedMedication[];
  medical_history?: NormalizedCondition[];
  surgical_history?: NormalizedSurgery[];
  family_history?: NormalizedFamilyHistory[];
  hospitalizations?: NormalizedHospitalization[];
  social_history?: NormalizedSocialHistory[];

  /** Story answers with full question text for AI context. */
  story_context?: NormalizedStoryAnswer[];

  /** Provenance marker: these values came from the user directly. */
  _source: "user_profiles";

  /**
   * True when at least one medical list has entries or current_symptoms is set.
   * Lets callers skip building the prompt section if there is nothing to say.
   */
  _has_clinical_data: boolean;
};

// ─── Story question labels ─────────────────────────────────────────────────────
// Must stay in sync with QUESTIONS in src/screens/App/StoryScreen.tsx.

const STORY_QUESTION_LABELS: Record<string, string> = {
  q1:  "Tell me about your relationships that are the most important to you and why.",
  q2:  "Tell me how you would describe your health approach. What does \"being healthy\" look like to you?",
  q3:  "Tell me about a positive memory you have from childhood. How old were you?",
  q4:  "Tell me about your parents' relationship when you were growing up. How did you feel with them and your siblings?",
  q5:  "What are things you are good at in terms of health, and what are things that are difficult for you?",
  q6:  "How would you describe the season of life you're in right now?",
  q7:  "What roles feel most important to you right now (parent, partner, worker, caregiver, etc.)?",
  q8:  "On a typical day, what takes most of your time and energy?",
  q9:  "If you had an extra free hour most days, how would you honestly want to use it?",
  q10: "When you hear the word \"health,\" what comes to mind first?",
};

// ─── Private helpers ───────────────────────────────────────────────────────────

/** Return trimmed string, or undefined if blank. */
function trimmed(s: string | null | undefined): string | undefined {
  const v = s?.trim();
  return v ? v : undefined;
}

/**
 * Coerce a JSONB value to a typed array, filtering out any non-object entries
 * that might appear due to schema drift.
 */
function safeArr<T extends object>(val: T[] | null | undefined): T[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v) => v !== null && typeof v === "object");
}

/**
 * Compute age in whole years from an ISO YYYY-MM-DD date_of_birth string.
 * Returns undefined if the string is missing or unparseable.
 */
function computeAge(dob: string | null | undefined): number | undefined {
  if (!dob) return undefined;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : undefined;
}

/** Return the object only if at least one value in it is defined. */
function presentIfAny<T extends Record<string, unknown>>(obj: T): T | undefined {
  return Object.values(obj).some((v) => v !== undefined) ? obj : undefined;
}

/**
 * Returns true for array items inserted by the AI backfill worker.
 * These items have IDs prefixed with "ai_" (generated by aiId() in profileBackfill.ts).
 * Manual items use makeId() from profileMedical.ts and never start with "ai_".
 */
function isAiBackfilled(id: string | undefined): boolean {
  return typeof id === "string" && id.startsWith("ai_");
}

// ─── Main builder ──────────────────────────────────────────────────────────────

/**
 * Convert a raw user_profiles row into a normalized ManualProfileContext.
 *
 * - All strings are trimmed; blank strings are omitted.
 * - List item `id` fields are stripped.
 * - Empty arrays are omitted (undefined, not []).
 * - Story answers include the full question label for AI readability.
 */
export function buildManualProfileContext(row: UserProfileRow): ManualProfileContext {
  // ── Demographics ────────────────────────────────────────────────────────────
  const firstName = trimmed(row.first_name);
  const lastName  = trimmed(row.last_name);
  const fullName  = [firstName, lastName].filter(Boolean).join(" ") || undefined;

  const dob    = trimmed(row.date_of_birth);
  const age    = computeAge(dob);
  const sex    = trimmed(row.sex_or_gender);
  const occ    = trimmed(row.occupation);
  const marital = trimmed(row.marital_status);
  const numChildren = (row.number_of_children != null && isFinite(row.number_of_children))
    ? row.number_of_children
    : undefined;

  const demographics: ManualProfileContext["demographics"] = {};
  if (fullName)     demographics.full_name        = fullName;
  if (dob)          demographics.date_of_birth    = dob;
  if (age != null)  demographics.age_years        = age;
  if (sex)          demographics.sex_or_gender    = sex;
  if (occ)          demographics.occupation       = occ;
  if (marital)      demographics.marital_status   = marital;
  if (numChildren != null) demographics.number_of_children = numChildren;

  // ── Lifestyle ───────────────────────────────────────────────────────────────
  const lifestyle = presentIfAny({
    smoking_status: trimmed(row.smoking_status),
    alcohol_use:    trimmed(row.alcohol_use),
    exercise_level: trimmed(row.exercise_level),
  });

  // ── Current symptoms ────────────────────────────────────────────────────────
  const currentSymptoms = trimmed(row.current_symptoms);

  // ── Allergies ───────────────────────────────────────────────────────────────
  const allergies = safeArr(row.allergies)
    .filter((a) => !isAiBackfilled(a.id))
    .map((a): NormalizedAllergy | null => {
      const allergen = trimmed(a.allergen);
      if (!allergen) return null;
      return {
        allergen,
        reaction: trimmed(a.reaction),
        severity: trimmed(a.severity),
      };
    })
    .filter((a): a is NormalizedAllergy => a !== null);

  // ── Medications ─────────────────────────────────────────────────────────────
  const medications = safeArr(row.medications)
    .filter((m) => !isAiBackfilled(m.id))
    .map((m): NormalizedMedication | null => {
      const name = trimmed(m.name);
      if (!name) return null;
      return {
        name,
        dose:      trimmed(m.dose),
        frequency: trimmed(m.frequency),
      };
    })
    .filter((m): m is NormalizedMedication => m !== null);

  // ── Medical history ─────────────────────────────────────────────────────────
  const medicalHistory = safeArr(row.medical_history)
    .filter((h) => !isAiBackfilled(h.id))
    .map((h): NormalizedCondition | null => {
      const condition = trimmed(h.condition);
      if (!condition) return null;
      return {
        condition,
        year:  trimmed(h.year),
        notes: trimmed(h.notes),
      };
    })
    .filter((h): h is NormalizedCondition => h !== null);

  // ── Surgical history ────────────────────────────────────────────────────────
  const surgicalHistory = safeArr(row.surgical_history)
    .filter((s) => !isAiBackfilled(s.id))
    .map((s): NormalizedSurgery | null => {
      const procedure = trimmed(s.procedure);
      if (!procedure) return null;
      return {
        procedure,
        year:  trimmed(s.year),
        notes: trimmed(s.notes),
      };
    })
    .filter((s): s is NormalizedSurgery => s !== null);

  // ── Family history ──────────────────────────────────────────────────────────
  const familyHistory = safeArr(row.family_history)
    .map((f): NormalizedFamilyHistory | null => {
      const condition = trimmed(f.condition);
      if (!condition) return null;
      return {
        condition,
        relation: trimmed(f.relation),
        notes:    trimmed(f.notes),
      };
    })
    .filter((f): f is NormalizedFamilyHistory => f !== null);

  // ── Hospitalizations ────────────────────────────────────────────────────────
  const hospitalizations = safeArr(row.hospitalizations)
    .map((h): NormalizedHospitalization | null => {
      const reason = trimmed(h.reason);
      if (!reason) return null;
      return {
        reason,
        year:  trimmed(h.year),
        notes: trimmed(h.notes),
      };
    })
    .filter((h): h is NormalizedHospitalization => h !== null);

  // ── Social history ──────────────────────────────────────────────────────────
  const socialHistory = safeArr(row.social_history)
    .map((s): NormalizedSocialHistory | null => {
      const category = trimmed(s.category);
      if (!category) return null;
      return {
        category,
        detail: trimmed(s.detail),
      };
    })
    .filter((s): s is NormalizedSocialHistory => s !== null);

  // ── Story answers ───────────────────────────────────────────────────────────
  // Only include answers that have non-empty text. Include the full question
  // label so the AI understands what each answer is about.
  const storyContext: NormalizedStoryAnswer[] = [];
  const sa = row.story_answers ?? {};
  for (const key of ["q1","q2","q3","q4","q5","q6","q7","q8","q9","q10"] as const) {
    const answer = trimmed(sa[key]);
    const question = STORY_QUESTION_LABELS[key];
    if (answer && question) {
      storyContext.push({ question, answer });
    }
  }

  // ── _has_clinical_data ──────────────────────────────────────────────────────
  const hasClinicalData =
    allergies.length > 0 ||
    medications.length > 0 ||
    medicalHistory.length > 0 ||
    surgicalHistory.length > 0 ||
    familyHistory.length > 0 ||
    hospitalizations.length > 0 ||
    socialHistory.length > 0 ||
    !!currentSymptoms;

  // ── Assemble ────────────────────────────────────────────────────────────────
  const ctx: ManualProfileContext = {
    demographics,
    _source: "user_profiles",
    _has_clinical_data: hasClinicalData,
  };

  if (lifestyle)                  ctx.lifestyle         = lifestyle;
  if (currentSymptoms)            ctx.current_symptoms  = currentSymptoms;
  if (allergies.length > 0)       ctx.allergies         = allergies;
  if (medications.length > 0)     ctx.medications       = medications;
  if (medicalHistory.length > 0)  ctx.medical_history   = medicalHistory;
  if (surgicalHistory.length > 0) ctx.surgical_history  = surgicalHistory;
  if (familyHistory.length > 0)   ctx.family_history    = familyHistory;
  if (hospitalizations.length > 0) ctx.hospitalizations = hospitalizations;
  if (socialHistory.length > 0)   ctx.social_history    = socialHistory;
  if (storyContext.length > 0)    ctx.story_context     = storyContext;

  return ctx;
}

// ─── Prompt serializer ─────────────────────────────────────────────────────────

/**
 * Serialize a ManualProfileContext into a compact, human-readable block for
 * inclusion in an LLM prompt.
 *
 * Format is intentionally prose-like (not JSON) so the model can read it
 * without needing to parse nested structures. Each section is only emitted
 * when data is present.
 */
export function serializeProfileContext(ctx: ManualProfileContext): string {
  const lines: string[] = [];

  lines.push("MANUAL_PROFILE (user-entered, treat as verified ground truth):");

  // ── Demographics ────────────────────────────────────────────────────────────
  const d = ctx.demographics;
  const demoParts: string[] = [];
  if (d.full_name)      demoParts.push(d.full_name);
  if (d.age_years != null && d.sex_or_gender) {
    demoParts.push(`${d.age_years} y/o ${d.sex_or_gender}`);
  } else if (d.age_years != null) {
    demoParts.push(`${d.age_years} y/o`);
  } else if (d.sex_or_gender) {
    demoParts.push(d.sex_or_gender);
  }
  if (d.date_of_birth && !d.age_years) demoParts.push(`DOB: ${d.date_of_birth}`);
  if (d.occupation)   demoParts.push(d.occupation);
  if (d.marital_status) {
    const children = d.number_of_children != null ? `, ${d.number_of_children} child${d.number_of_children !== 1 ? "ren" : ""}` : "";
    demoParts.push(`${d.marital_status}${children}`);
  } else if (d.number_of_children != null) {
    demoParts.push(`${d.number_of_children} child${d.number_of_children !== 1 ? "ren" : ""}`);
  }
  if (demoParts.length > 0) {
    lines.push(`Demographics: ${demoParts.join(" · ")}`);
  }

  // ── Lifestyle ───────────────────────────────────────────────────────────────
  if (ctx.lifestyle) {
    const ls = ctx.lifestyle;
    const lsParts: string[] = [];
    if (ls.smoking_status) lsParts.push(`Smoking: ${ls.smoking_status}`);
    if (ls.alcohol_use)    lsParts.push(`Alcohol: ${ls.alcohol_use}`);
    if (ls.exercise_level) lsParts.push(`Exercise: ${ls.exercise_level}`);
    if (lsParts.length > 0) lines.push(`Lifestyle: ${lsParts.join(" · ")}`);
  }

  // ── Current symptoms ────────────────────────────────────────────────────────
  if (ctx.current_symptoms) {
    lines.push(`Current Symptoms: ${ctx.current_symptoms}`);
  }

  // ── Allergies ───────────────────────────────────────────────────────────────
  if (ctx.allergies && ctx.allergies.length > 0) {
    lines.push(`Allergies (${ctx.allergies.length}):`);
    for (const a of ctx.allergies) {
      const parts = [a.allergen];
      if (a.reaction) parts.push(`reaction: ${a.reaction}`);
      if (a.severity) parts.push(`severity: ${a.severity}`);
      lines.push(`  • ${parts.join(", ")}`);
    }
  }

  // ── Medications ─────────────────────────────────────────────────────────────
  if (ctx.medications && ctx.medications.length > 0) {
    lines.push(`Current Medications (${ctx.medications.length}):`);
    for (const m of ctx.medications) {
      const detail = [m.dose, m.frequency].filter(Boolean).join(", ");
      lines.push(`  • ${m.name}${detail ? ` — ${detail}` : ""}`);
    }
  }

  // ── Medical history ─────────────────────────────────────────────────────────
  if (ctx.medical_history && ctx.medical_history.length > 0) {
    lines.push(`Medical History (${ctx.medical_history.length}):`);
    for (const h of ctx.medical_history) {
      const detail = [h.year, h.notes].filter(Boolean).join(", ");
      lines.push(`  • ${h.condition}${detail ? ` (${detail})` : ""}`);
    }
  }

  // ── Surgical history ────────────────────────────────────────────────────────
  if (ctx.surgical_history && ctx.surgical_history.length > 0) {
    lines.push(`Surgical History (${ctx.surgical_history.length}):`);
    for (const s of ctx.surgical_history) {
      const detail = [s.year, s.notes].filter(Boolean).join(", ");
      lines.push(`  • ${s.procedure}${detail ? ` (${detail})` : ""}`);
    }
  }

  // ── Family history ──────────────────────────────────────────────────────────
  if (ctx.family_history && ctx.family_history.length > 0) {
    lines.push(`Family History (${ctx.family_history.length}):`);
    for (const f of ctx.family_history) {
      const rel = f.relation ? ` — ${f.relation}` : "";
      const notes = f.notes ? ` (${f.notes})` : "";
      lines.push(`  • ${f.condition}${rel}${notes}`);
    }
  }

  // ── Hospitalizations ────────────────────────────────────────────────────────
  if (ctx.hospitalizations && ctx.hospitalizations.length > 0) {
    lines.push(`Hospitalizations (${ctx.hospitalizations.length}):`);
    for (const h of ctx.hospitalizations) {
      const detail = [h.year, h.notes].filter(Boolean).join(", ");
      lines.push(`  • ${h.reason}${detail ? ` (${detail})` : ""}`);
    }
  }

  // ── Social history ──────────────────────────────────────────────────────────
  if (ctx.social_history && ctx.social_history.length > 0) {
    lines.push(`Social History (${ctx.social_history.length}):`);
    for (const s of ctx.social_history) {
      lines.push(`  • ${s.category}${s.detail ? `: ${s.detail}` : ""}`);
    }
  }

  // ── Story context ───────────────────────────────────────────────────────────
  if (ctx.story_context && ctx.story_context.length > 0) {
    lines.push(`Personal Health Context (patient's own words, use for holistic understanding):`);
    for (const qa of ctx.story_context) {
      lines.push(`  Q: ${qa.question}`);
      lines.push(`  A: "${qa.answer}"`);
    }
  }

  return lines.join("\n");
}

// ─── Provenance helper ─────────────────────────────────────────────────────────

/**
 * Determine which medical list fields in a ManualProfileContext have user-entered
 * data. Returns a set of field names where manual data is present.
 *
 * Use this in AI backfill logic to avoid overwriting explicitly entered values:
 *
 *   const manualFields = getManuallyEnteredFields(ctx);
 *   if (!manualFields.has("allergies")) {
 *     // safe to backfill allergies from AI output
 *   }
 */
export function getManuallyEnteredFields(ctx: ManualProfileContext): Set<string> {
  const fields = new Set<string>();
  if (ctx.allergies && ctx.allergies.length > 0)         fields.add("allergies");
  if (ctx.medications && ctx.medications.length > 0)     fields.add("medications");
  if (ctx.medical_history && ctx.medical_history.length > 0) fields.add("medical_history");
  if (ctx.surgical_history && ctx.surgical_history.length > 0) fields.add("surgical_history");
  if (ctx.family_history && ctx.family_history.length > 0) fields.add("family_history");
  if (ctx.hospitalizations && ctx.hospitalizations.length > 0) fields.add("hospitalizations");
  if (ctx.social_history && ctx.social_history.length > 0) fields.add("social_history");
  if (ctx.current_symptoms)                               fields.add("current_symptoms");
  if (ctx.lifestyle?.smoking_status)                      fields.add("smoking_status");
  if (ctx.lifestyle?.alcohol_use)                         fields.add("alcohol_use");
  if (ctx.lifestyle?.exercise_level)                      fields.add("exercise_level");
  if (ctx.demographics.sex_or_gender)                     fields.add("sex_or_gender");
  if (ctx.demographics.date_of_birth)                     fields.add("date_of_birth");
  return fields;
}

// ─── AI-backfilled context ─────────────────────────────────────────────────────

/**
 * The subset of user_profiles arrays that were inserted by the AI backfill
 * worker (items whose id starts with "ai_"). These values have never been
 * explicitly reviewed or confirmed by the patient.
 *
 * Passed to evaluateUserHealth as a separate lower-trust source so the model
 * does not treat these as patient-verified ground truth.
 */
export type AiBackfilledContext = {
  allergies?: NormalizedAllergy[];
  medications?: NormalizedMedication[];
  medical_history?: NormalizedCondition[];
  surgical_history?: NormalizedSurgery[];
};

/**
 * Extract AI-backfilled items from a raw profile row.
 * Returns null when no AI-backfilled items exist (common on first run).
 */
export function buildAiBackfilledContext(row: UserProfileRow): AiBackfilledContext | null {
  const allergies = safeArr(row.allergies)
    .filter((a) => isAiBackfilled(a.id))
    .map((a): NormalizedAllergy | null => {
      const allergen = trimmed(a.allergen);
      if (!allergen) return null;
      return { allergen, reaction: trimmed(a.reaction), severity: trimmed(a.severity) };
    })
    .filter((a): a is NormalizedAllergy => a !== null);

  const medications = safeArr(row.medications)
    .filter((m) => isAiBackfilled(m.id))
    .map((m): NormalizedMedication | null => {
      const name = trimmed(m.name);
      if (!name) return null;
      return { name, dose: trimmed(m.dose), frequency: trimmed(m.frequency) };
    })
    .filter((m): m is NormalizedMedication => m !== null);

  const medical_history = safeArr(row.medical_history)
    .filter((h) => isAiBackfilled(h.id))
    .map((h): NormalizedCondition | null => {
      const condition = trimmed(h.condition);
      if (!condition) return null;
      return { condition, year: trimmed(h.year), notes: trimmed(h.notes) };
    })
    .filter((h): h is NormalizedCondition => h !== null);

  const surgical_history = safeArr(row.surgical_history)
    .filter((s) => isAiBackfilled(s.id))
    .map((s): NormalizedSurgery | null => {
      const procedure = trimmed(s.procedure);
      if (!procedure) return null;
      return { procedure, year: trimmed(s.year), notes: trimmed(s.notes) };
    })
    .filter((s): s is NormalizedSurgery => s !== null);

  if (
    allergies.length === 0 &&
    medications.length === 0 &&
    medical_history.length === 0 &&
    surgical_history.length === 0
  ) {
    return null;
  }

  const ctx: AiBackfilledContext = {};
  if (allergies.length > 0)      ctx.allergies       = allergies;
  if (medications.length > 0)    ctx.medications     = medications;
  if (medical_history.length > 0) ctx.medical_history = medical_history;
  if (surgical_history.length > 0) ctx.surgical_history = surgical_history;
  return ctx;
}

/**
 * Serialize an AiBackfilledContext into a prompt block labeled as lower-trust
 * AI-suggested data, clearly distinguished from MANUAL_PROFILE.
 */
export function serializeBackfilledContext(ctx: AiBackfilledContext): string {
  const lines: string[] = [];
  lines.push("PROFILE_BACKFILL (AI-suggested from prior document analysis — patient has NOT verified these; lower trust than MANUAL_PROFILE):");

  if (ctx.allergies && ctx.allergies.length > 0) {
    lines.push(`Allergies (${ctx.allergies.length}):`);
    for (const a of ctx.allergies) {
      const parts = [a.allergen];
      if (a.reaction) parts.push(`reaction: ${a.reaction}`);
      if (a.severity) parts.push(`severity: ${a.severity}`);
      lines.push(`  • ${parts.join(", ")}`);
    }
  }

  if (ctx.medications && ctx.medications.length > 0) {
    lines.push(`Medications (${ctx.medications.length}):`);
    for (const m of ctx.medications) {
      const detail = [m.dose, m.frequency].filter(Boolean).join(", ");
      lines.push(`  • ${m.name}${detail ? ` — ${detail}` : ""}`);
    }
  }

  if (ctx.medical_history && ctx.medical_history.length > 0) {
    lines.push(`Medical History (${ctx.medical_history.length}):`);
    for (const h of ctx.medical_history) {
      const detail = [h.year, h.notes].filter(Boolean).join(", ");
      lines.push(`  • ${h.condition}${detail ? ` (${detail})` : ""}`);
    }
  }

  if (ctx.surgical_history && ctx.surgical_history.length > 0) {
    lines.push(`Surgical History (${ctx.surgical_history.length}):`);
    for (const s of ctx.surgical_history) {
      const detail = [s.year, s.notes].filter(Boolean).join(", ");
      lines.push(`  • ${s.procedure}${detail ? ` (${detail})` : ""}`);
    }
  }

  return lines.join("\n");
}
