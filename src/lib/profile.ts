import type {
  AllergyItem,
  MedicationItem,
  MedHistoryItem,
  SurgeryItem,
  FamilyHistoryItem,
  HospitalizationItem,
  SocialHistoryItem,
} from "./profileMedical";

/** Keys q1–q10 are stable; question text lives in StoryScreen. */
export type StoryAnswers = {
  q1?: string; q2?: string; q3?: string; q4?: string; q5?: string;
  q6?: string; q7?: string; q8?: string; q9?: string; q10?: string;
};

/**
 * Provenance record for AI-backfilled array fields in user_profiles.
 * Stored in user_profiles.ai_backfill_meta (JSONB column).
 *
 * added_keys: normalized canonical keys of every item the AI has ever inserted
 *   into this field. Persists across runs so the worker can detect user deletions.
 *
 * current_item_ids: item IDs that were AI-inserted and still present.
 *   Future UI can use this to render an "AI suggested" badge on individual items.
 */
export type AiBackfillArrayFieldMeta = {
  source: "ai";
  job_id: string;
  evaluation_id: string | null;
  last_backfill_at: string;
  added_keys: string[];
  current_item_ids: string[];
};

export type AiBackfillMeta = {
  fields: Partial<Record<
    "allergies" | "medications" | "medical_history" | "surgical_history",
    AiBackfillArrayFieldMeta
  >>;
  last_backfill_at: string;
};

export type UserProfile = {
  id: string;
  user_id: string;

  // ── Basic personal info ──────────────────────────────
  first_name: string;
  last_name: string;
  date_of_birth: string | null;     // ISO: YYYY-MM-DD
  sex_or_gender: string | null;

  // ── Personal details ─────────────────────────────────
  occupation: string | null;
  marital_status: string | null;
  number_of_children: number | null;

  // ── Contact ──────────────────────────────────────────
  email: string | null;
  mobile_phone: string | null;

  // ── Emergency contact ────────────────────────────────
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;

  // ── Onboarding gate ──────────────────────────────────
  onboarding_completed_at: string | null;

  // ── Lifestyle (atomic values) ────────────────────────
  smoking_status: string | null;
  alcohol_use: string | null;
  exercise_level: string | null;

  // ── Current symptoms note ────────────────────────────
  current_symptoms: string | null;

  // ── Structured medical lists (JSONB arrays) ──────────
  allergies: AllergyItem[] | null;
  medications: MedicationItem[] | null;
  medical_history: MedHistoryItem[] | null;
  surgical_history: SurgeryItem[] | null;
  family_history: FamilyHistoryItem[] | null;
  hospitalizations: HospitalizationItem[] | null;
  social_history: SocialHistoryItem[] | null;

  // ── Story / personal context (JSONB, coaching use only) ──────
  story_answers: StoryAnswers | null;

  // ── AI backfill provenance ────────────────────────────────────
  // Null until the worker has run a backfill. Read-only from the app's
  // perspective — only the worker writes this field.
  ai_backfill_meta?: AiBackfillMeta | null;

  /** Storage path inside the `profile-pictures` bucket. e.g. `{user_id}/avatar.jpg`. */
  avatar_path?: string | null;

  /** Server-computed AI review counts (read-only); drives the "N to review" nudge. */
  ai_review?: { total: number; unreviewed: number };

  created_at: string;
  updated_at: string;
};

/**
 * Stable JSON signature of the user's manually-entered medical/lifestyle fields.
 * Used to detect whether the profile changed enough to warrant re-evaluation.
 */
export function manualProfileSignature(p: UserProfile | null | undefined): string {
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const text = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s ? s : null;
  };

  return JSON.stringify({
    date_of_birth: p?.date_of_birth ?? null,
    sex_or_gender: p?.sex_or_gender ?? null,
    current_symptoms: text(p?.current_symptoms),
    smoking_status: p?.smoking_status ?? null,
    alcohol_use: p?.alcohol_use ?? null,
    exercise_level: p?.exercise_level ?? null,
    allergies: list(p?.allergies),
    medications: list(p?.medications),
    medical_history: list(p?.medical_history),
    surgical_history: list(p?.surgical_history),
    family_history: list(p?.family_history),
    hospitalizations: list(p?.hospitalizations),
    social_history: list(p?.social_history),
  });
}

// `userId` is optional and ignored — the profile endpoint is JWT-scoped to the
// current user. Kept for call-site compatibility; never used to fetch another user.
export async function getProfile(_userId?: string): Promise<UserProfile | null> {
  const data = await import("./api/data").then((m) => m.getProfile());
  return data;
}

export async function upsertProfile(
  userId: string,
  patch: Partial<Omit<UserProfile, "id" | "user_id" | "created_at" | "updated_at">>
): Promise<UserProfile> {
  const data = await import("./api/data").then((m) => m.updateProfile(patch));
  return data;
}
