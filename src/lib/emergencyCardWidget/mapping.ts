// Pure mapping from health_profiles.card_json to the widget payload.
// No react-native / native imports here so it is unit-testable under Vitest.

export interface ThreeByFiveCard {
  blood_type?: string | null;
  major_conditions?: string[] | null;
  major_surgeries?: string[] | null;
  current_meds?: string[] | null;
  allergies?: string[] | null;
  implants_devices?: string[] | null;
  anticoagulants?: string[] | null;
  anesthesia_notes?: string[] | null;
  emergency_contact?: { name?: string | null; phone?: string | null } | null;
  one_line_summary?: string | null;
}

export interface EmergencyCardWidgetPayload {
  schema_version: 1;
  blood_type: string | null;
  allergies: string[];
  emergency_contact: { name: string | null; phone: string | null };
  major_conditions: string[];
  current_meds: string[];
  anticoagulants: string[];
  implants_devices: string[];
  anesthesia_notes: string[];
  major_surgeries: string[];
  one_line_summary: string;
  updated_at: string | null;
}

function cleanArray(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}

export function mapCardToPayload(
  card: ThreeByFiveCard | null | undefined,
  updatedAt: string | null | undefined,
): EmergencyCardWidgetPayload {
  return {
    schema_version: 1,
    blood_type: card?.blood_type ?? null,
    allergies: cleanArray(card?.allergies),
    emergency_contact: {
      name: card?.emergency_contact?.name ?? null,
      phone: card?.emergency_contact?.phone ?? null,
    },
    major_conditions: cleanArray(card?.major_conditions),
    current_meds: cleanArray(card?.current_meds),
    anticoagulants: cleanArray(card?.anticoagulants),
    implants_devices: cleanArray(card?.implants_devices),
    anesthesia_notes: cleanArray(card?.anesthesia_notes),
    major_surgeries: cleanArray(card?.major_surgeries),
    one_line_summary: card?.one_line_summary ?? "",
    updated_at: updatedAt ?? null,
  };
}
