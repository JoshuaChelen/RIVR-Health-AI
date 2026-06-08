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

  created_at: string;
  updated_at: string;
};

export async function getProfile(userId: string): Promise<UserProfile | null> {
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
