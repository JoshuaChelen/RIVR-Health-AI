import { requestCancelJob } from "./aiJobs";
import { api } from "./api/client";
import { deleteDocument as deleteDocumentApi, getProfile as getProfileData } from "./api/data";

type ManualProfileRow = {
  date_of_birth: string | null;
  sex_or_gender: string | null;
  allergies: unknown[] | null;
  medications: unknown[] | null;
  medical_history: unknown[] | null;
  surgical_history: unknown[] | null;
  family_history: unknown[] | null;
  hospitalizations: unknown[] | null;
  social_history: unknown[] | null;
  current_symptoms: string | null;
  smoking_status: string | null;
  alcohol_use: string | null;
  exercise_level: string | null;
};

export async function deleteDocument(docId: string, userId: string, storagePath: string | null) {
  // Must delete dependent rows first — FK constraints have no ON DELETE CASCADE.
  // timeline_events and document_facts both reference documents(id).
  // Server scopes to the JWT user; no userId filter needed.
  await deleteDocumentApi(docId);
}

export async function cancelProcessing(docId: string, userId: string): Promise<void> {
  // Find the active job for this document and signal the worker to stop.
  // The worker is responsible for reverting the document status back to 'uploaded'.
  const { results: jobs } = await api.get<{ results: { id: string }[] }>("/api/ai-jobs/?status__in=queued,running&contains_document_id=" + encodeURIComponent(docId) + "&limit=1");

  if (jobs && jobs.length > 0) {
    await requestCancelJob(jobs[0].id);
  }
}

export function safeFilename(name: string) {
  return name.replace(/[^\w.\-() ]+/g, "_");
}

/**
 * Upsert the one canonical "Manual Health Profile" document for this user.
 *
 * - Creates the row on first call.
 * - On subsequent calls: resets status to 'uploaded' (profile changed → needs
 *   re-processing) and refreshes the lightweight content_json snapshot.
 * - The partial unique index documents_manual_input_per_user enforces at most
 *   one row per user with source_type = 'manual_input'.
 */
export async function upsertManualInputDocument(userId: string): Promise<void> {
  const profileRaw = await getProfileData();

const profile = (profileRaw ?? null) as ManualProfileRow | null;

  const count = (arr: unknown) => (Array.isArray(arr) ? arr.length : 0);

  const hasMeaningfulData = !!(
    profile?.date_of_birth ||
    profile?.sex_or_gender ||
    (profile?.current_symptoms && String(profile.current_symptoms).trim()) ||
    profile?.smoking_status ||
    profile?.alcohol_use ||
    profile?.exercise_level ||
    count(profile?.allergies) ||
    count(profile?.medications) ||
    count(profile?.medical_history) ||
    count(profile?.surgical_history) ||
    count(profile?.family_history) ||
    count(profile?.hospitalizations) ||
    count(profile?.social_history)
  );

  const snapshot = {
    generated_at: new Date().toISOString(),
    has_demographics: !!(profile?.date_of_birth || profile?.sex_or_gender),
    allergies_count: count(profile?.allergies),
    medications_count: count(profile?.medications),
    conditions_count: count(profile?.medical_history),
    surgeries_count: count(profile?.surgical_history),
    family_history_count: count(profile?.family_history),
    hospitalizations_count: count(profile?.hospitalizations),
    social_history_count: count(profile?.social_history),
    has_symptoms: !!(profile?.current_symptoms && String(profile.current_symptoms).trim()),
    has_lifestyle: !!(profile?.smoking_status || profile?.alcohol_use || profile?.exercise_level),
  };

  const { results: existingDocs } = await api.get<{ results: any[] }>("/api/documents/?source_type=manual_input&limit=1");
  const existing = existingDocs && existingDocs.length > 0 ? existingDocs[0] : null;

  if (!hasMeaningfulData) {
    if (existing?.id) {
      await deleteDocument(existing.id, userId, null);
    }
    return;
  }

  if (existing?.id) {
    await api.patch("/api/documents/" + existing.id + "/", {
      content_json: snapshot,
      status: "uploaded",
      processing_error: "",
    });
  } else {
    await api.post("/api/documents/", {
      title: "Medical Profile Record",
      source_type: "manual_input",
      content_json: snapshot,
      status: "uploaded",
      mime_type: "application/json",
      processing_error: "",
    });
  }
}

