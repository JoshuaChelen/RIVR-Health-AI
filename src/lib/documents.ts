import { supabase } from "./supabase";

const STORAGE_BUCKET = "documents";

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

export async function cancelProcessing(docId: string, userId: string) {
  const { error } = await supabase
    .from("documents")
    .update({ status: "uploaded", processing_error: null })
    .eq("id", docId)
    .eq("user_id", userId);
  if (error) throw error;
}

export function safeFilename(name: string) {
  return name.replace(/[^\w.\-() ]+/g, "_");
}

export async function insertDocumentRow(params: {
  userId: string;
  title: string;
  storagePath: string;      // can be PDF or audio, we store it in pdf_path for now
  mimeType?: string | null;
  sizeBytes?: number | null;
}) {
  const { data, error } = await supabase
    .from("documents")
    .insert([
      {
        user_id: params.userId,
        title: params.title,

        // NOTE: we reuse pdf_path to store the original file path (PDF or audio)
        pdf_path: params.storagePath,

        status: "uploaded",
        mime_type: params.mimeType ?? "application/octet-stream",
        size_bytes: typeof params.sizeBytes === "number" ? params.sizeBytes : null,

        processing_error: null,
        processed_at: null,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data as { id: string };
}