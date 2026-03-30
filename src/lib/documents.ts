import { supabase } from "./supabase";
import { requestCancelJob } from "./aiJobs";
import { uploadUriToStorage, uploadBytesToStorage } from "./storageUpload";

const STORAGE_BUCKET = "documents";

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
  const { error: e1 } = await supabase
    .from("timeline_events")
    .delete()
    .eq("document_id", docId)
    .eq("user_id", userId);
  if (e1) throw e1;

  const { error: e2 } = await supabase
    .from("document_facts")
    .delete()
    .eq("document_id", docId)
    .eq("user_id", userId);
  if (e2) throw e2;

  // share_package_items has no user_id column — best effort
  await supabase.from("share_package_items").delete().eq("document_id", docId);

  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", docId)
    .eq("user_id", userId);
  if (error) throw error;

  if (storagePath) {
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
  }
}

export async function cancelProcessing(docId: string, userId: string): Promise<void> {
  // Find the active job for this document and signal the worker to stop.
  // The worker is responsible for reverting the document status back to 'uploaded'.
  const { data: jobs } = await supabase
    .from("ai_jobs")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["queued", "running"])
    .contains("document_ids", [docId])
    .limit(1);

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
  const { data: profileRaw, error: profileError } = await supabase
  .from("user_profiles")
  .select(
    "date_of_birth, sex_or_gender," +
    "allergies, medications, medical_history," +
    "surgical_history, family_history, hospitalizations," +
    "social_history, current_symptoms," +
    "smoking_status, alcohol_use, exercise_level"
  )
  .eq("user_id", userId)
  .maybeSingle();

if (profileError) throw profileError;

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

  const { data: existing } = await supabase
    .from("documents")
    .select("id")
    .eq("user_id", userId)
    .eq("source_type", "manual_input")
    .maybeSingle();

  if (!hasMeaningfulData) {
    if (existing?.id) {
      await deleteDocument(existing.id, userId, null);
    }
    return;
  }

  if (existing?.id) {
    await supabase
      .from("documents")
      .update({
        content_json: snapshot,
        status: "uploaded",
        processing_error: null,
        processed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("user_id", userId);
  } else {
    await supabase
      .from("documents")
      .insert({
        user_id: userId,
        title: "Medical Profile Record",
        source_type: "manual_input",
        content_json: snapshot,
        status: "uploaded",
        mime_type: "application/json",
        processing_error: null,
        processed_at: null,
      });
  }
}

/**
 * Check if a document with the same title and file size already exists for this user.
 * Returns the matching row if found, or null.
 */
export async function checkDuplicateDocument(
  userId: string,
  title: string,
  sizeBytes: number,
): Promise<{ id: string; title: string; created_at: string } | null> {
  const { data } = await supabase
    .from("documents")
    .select("id, title, created_at")
    .eq("user_id", userId)
    .eq("title", title)
    .eq("size_bytes", sizeBytes)
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

export async function insertDocumentRow(params: {
  userId: string;
  title: string;
  storagePath: string;      // can be PDF, audio, or image — stored in pdf_path
  mimeType?: string | null;
  sizeBytes?: number | null;
  sourceType?: string | null;
}) {
  const { data, error } = await supabase
    .from("documents")
    .insert([
      {
        user_id: params.userId,
        title: params.title,

        // NOTE: we reuse pdf_path to store the original file path (PDF, audio, or image)
        pdf_path: params.storagePath,

        status: "uploaded",
        mime_type: params.mimeType ?? "application/octet-stream",
        size_bytes: typeof params.sizeBytes === "number" ? params.sizeBytes : null,
        source_type: params.sourceType ?? undefined,

        processing_error: null,
        processed_at: null,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data as { id: string };
}

/**
 * Shared upload pipeline: upload a file URI to storage then insert a documents row.
 * Used by UploadFile for PDF, gallery photo, and camera scan flows.
 */
export async function uploadAndInsertDocument(params: {
  userId: string;
  uri: string;
  fileName: string;
  mimeType: string;
  sourceType: string;
  title?: string;
}): Promise<{ id: string }> {
  const cleanName = safeFilename(params.fileName);
  const folder = params.sourceType.startsWith("image") ? "medical-images" : "medical-documents";
  const storagePath = `${params.userId}/${folder}/${Date.now()}_${cleanName}`;

  const { sizeBytes } = await uploadUriToStorage({
    bucket: "documents",
    storagePath,
    uri: params.uri,
    contentType: params.mimeType,
    upsert: false,
  });

  return insertDocumentRow({
    userId: params.userId,
    title: params.title ?? cleanName,
    storagePath,
    mimeType: params.mimeType,
    sizeBytes,
    sourceType: params.sourceType,
  });
}

/**
 * Upload pre-compiled bytes (e.g. a Uint8Array from pdf-lib on web) to storage
 * then insert a documents row. No URI or temp file required.
 */
export async function uploadBytesAndInsertDocument(params: {
  userId: string;
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  sourceType: string;
  title?: string;
}): Promise<{ id: string }> {
  const cleanName = safeFilename(params.fileName);
  const storagePath = `${params.userId}/medical-documents/${Date.now()}_${cleanName}`;

  const { sizeBytes } = await uploadBytesToStorage({
    bucket: "documents",
    storagePath,
    bytes: params.bytes,
    contentType: params.mimeType,
    upsert: false,
  });

  return insertDocumentRow({
    userId: params.userId,
    title: params.title ?? cleanName,
    storagePath,
    mimeType: params.mimeType,
    sizeBytes,
    sourceType: params.sourceType,
  });
}