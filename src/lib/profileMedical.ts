// Types for the JSONB list columns on user_profiles.
// All fields are strings (not strict enums) so the data stays portable.

export type AllergyItem = {
  id: string;
  allergen: string;
  reaction: string;   // optional in UI but required on type for simplicity
  severity: string;   // Mild | Moderate | Severe | ""
  type?: "allergy" | "intolerance";   // absent ⇒ allergy
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

/** Generate a lightweight unique ID for list items (client-side only). */
export function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Safely coerce a JSONB value to a typed array. */
export function safeList<T>(val: unknown): T[] {
  return Array.isArray(val) ? (val as T[]) : [];
}

/** Join non-empty string parts with ` · ` */
export function joinParts(...parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p && p.trim()).join(" · ");
}
