import { supabase } from "./supabase";

/** Keys q1–q10 are stable; question text lives in StoryScreen. */
export type StoryAnswers = {
  q1?: string; q2?: string; q3?: string; q4?: string; q5?: string;
  q6?: string; q7?: string; q8?: string; q9?: string; q10?: string;
};
import type {
  AllergyItem,
  MedicationItem,
  MedHistoryItem,
  SurgeryItem,
  FamilyHistoryItem,
  HospitalizationItem,
  SocialHistoryItem,
} from "./profileMedical";

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

  created_at: string;
  updated_at: string;
};

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return data;
}

export async function upsertProfile(
  userId: string,
  patch: Partial<Omit<UserProfile, "id" | "user_id" | "created_at" | "updated_at">>
): Promise<UserProfile> {
  const { data, error } = await supabase
    .from("user_profiles")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
